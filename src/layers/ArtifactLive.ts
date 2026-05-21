import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { BlobClient, BlockBlobClient } from "@azure/storage-blob";
import { HttpClient } from "@effect/platform";
import { Effect, Layer, Option, Redacted } from "effect";
import { ArtifactError } from "../errors/ArtifactError.js";
import type { ArtifactItem } from "../services/Artifact.js";
import { Artifact } from "../services/Artifact.js";
import { UPLOAD_CHUNK_SIZE, UPLOAD_CONCURRENCY, UPLOAD_MAX_SINGLE_SHOT } from "./internal/azureUpload.js";
import type { BackendIds } from "./internal/backendIds.js";
import { getBackendIdsFromEnv } from "./internal/backendIds.js";
import {
	CONFLICT,
	isRetryableTwirpReason,
	makeTwirpRetrySchedule,
	twirpCall as twirpCallShared,
} from "./internal/twirp.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWIRP_SERVICE = "github.actions.results.api.v1.ArtifactService";

/**
 * CreateArtifact `version` field. Confirmed `7` against `actions/toolkit`
 * `main` (`artifact/src/internal/upload/upload-artifact.ts`, verified
 * 2026-05-21) — NOT `4` as the WS4 spec guessed.
 */
const ARTIFACT_VERSION = 7;

type ArtifactOperation = "upload" | "download" | "list" | "get" | "delete";

const RETRY_SCHEDULE = makeTwirpRetrySchedule((error: ArtifactError) => error.reason);

// ---------------------------------------------------------------------------
// Env + Twirp
// ---------------------------------------------------------------------------

/**
 * Read the artifact protocol env vars (`ACTIONS_RESULTS_URL`,
 * `ACTIONS_RUNTIME_TOKEN`) — the same two the cache layer uses — and decode the
 * run/job backend ids from the runtime token's `scp` claim.
 */
const getArtifactEnv = (operation: ArtifactOperation, artifact: string) =>
	Effect.gen(function* () {
		const env = yield* Effect.try({
			try: () => {
				const resultsUrl = process.env.ACTIONS_RESULTS_URL;
				const token = process.env.ACTIONS_RUNTIME_TOKEN;
				if (!resultsUrl || !token) {
					throw new Error(
						`Missing required env vars: ${[!resultsUrl && "ACTIONS_RESULTS_URL", !token && "ACTIONS_RUNTIME_TOKEN"].filter(Boolean).join(", ")}`,
					);
				}
				const baseUrl = resultsUrl.endsWith("/") ? resultsUrl : `${resultsUrl}/`;
				return { baseUrl, token };
			},
			catch: (error) =>
				new ArtifactError({
					operation,
					artifact,
					reason: error instanceof Error ? error.message : String(error),
				}),
		});
		const backendIds = yield* getBackendIdsFromEnv(artifact, operation);
		// Hold the runtime token redacted; it is unwrapped only inside the shared
		// Twirp request builder, at the request boundary (S9).
		return { baseUrl: env.baseUrl, token: Redacted.make(env.token), backendIds };
	});

const twirpCall = <T>(
	http: HttpClient.HttpClient,
	baseUrl: string,
	token: Redacted.Redacted<string>,
	method: string,
	body: Record<string, unknown>,
	operation: ArtifactOperation,
	artifact: string,
) =>
	twirpCallShared<T, ArtifactError>(
		http,
		baseUrl,
		TWIRP_SERVICE,
		token,
		method,
		body,
		(reason) => new ArtifactError({ operation, artifact, reason, retryable: isRetryableTwirpReason(reason) }),
	);

// ---------------------------------------------------------------------------
// Twirp response shapes (Twirp JSON; field names read defensively in both
// camelCase and snake_case since the protocol is reverse-engineered).
// ---------------------------------------------------------------------------

interface CreateArtifactResponse {
	readonly ok?: boolean;
	readonly signedUploadUrl?: string;
	readonly signed_upload_url?: string;
}

interface FinalizeArtifactResponse {
	readonly ok?: boolean;
	readonly artifactId?: string;
	readonly artifact_id?: string;
}

// Distinct from FinalizeArtifactResponse (same shape today, but the delete RPC
// is a separate protocol message — avoid coupling the two if either diverges).
interface DeleteArtifactResponse {
	readonly ok?: boolean;
	readonly artifactId?: string;
	readonly artifact_id?: string;
}

interface ListArtifactsResponse {
	readonly artifacts?: ReadonlyArray<{
		readonly databaseId?: string;
		readonly database_id?: string;
		readonly name?: string;
		readonly size?: string;
		readonly createdAt?: string;
		readonly created_at?: string;
	}>;
}

interface GetSignedArtifactURLResponse {
	readonly signedUrl?: string;
	readonly signed_url?: string;
}

const pickSignedUploadUrl = (r: CreateArtifactResponse): string | undefined => r.signedUploadUrl ?? r.signed_upload_url;
const pickArtifactId = (r: FinalizeArtifactResponse): string | undefined => r.artifactId ?? r.artifact_id;
const pickDeleteArtifactId = (r: DeleteArtifactResponse): string | undefined => r.artifactId ?? r.artifact_id;
const pickSignedDownloadUrl = (r: GetSignedArtifactURLResponse): string | undefined => r.signedUrl ?? r.signed_url;

const toArtifactItem = (a: NonNullable<ListArtifactsResponse["artifacts"]>[number]): ArtifactItem => {
	const createdAt = a.createdAt ?? a.created_at;
	return {
		id: Number(a.databaseId ?? a.database_id ?? 0),
		name: a.name ?? "",
		size: Number(a.size ?? 0),
		...(createdAt !== undefined ? { createdAt } : {}),
	};
};

// ---------------------------------------------------------------------------
// Zip + hashing + cleanup
// ---------------------------------------------------------------------------

/**
 * Zip `files` (relative to `rootDirectory`) into a temp archive.
 *
 * Shells out to `zip` (POSIX) / PowerShell `System.IO.Compression.ZipFile`
 * (Windows) to preserve the zero-CJS posture, following the `tar` precedent in
 * `ActionCacheLive.createArchive` and the Windows fallback in
 * `ToolInstallerLive.extractZip`.
 */
const createZip = (files: ReadonlyArray<string>, rootDirectory: string, artifact: string, compressionLevel = 6) =>
	Effect.try({
		try: () => {
			if (files.length === 0) {
				throw new Error("No files provided to upload");
			}
			const zipPath = join(tmpdir(), `artifact-${randomUUID()}.zip`);
			// Store entries relative to `rootDirectory` so the archive (and any
			// later extraction) preserves the artifact-relative layout rather than
			// the absolute on-disk path. `zip`/Compress-Archive otherwise store the
			// paths exactly as given (absolute paths minus the leading separator).
			const relFiles = files.map((f) => relative(rootDirectory, f));
			if (process.platform === "win32") {
				const fileList = relFiles.map((f) => `'${f.replace(/'/g, "''")}'`).join(",");
				const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; Compress-Archive -Path ${fileList} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
				try {
					execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
						cwd: rootDirectory,
						stdio: "pipe",
					});
				} catch {
					execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
						cwd: rootDirectory,
						stdio: "pipe",
					});
				}
			} else {
				// -q quiet, -r recurse, -<n> zlib level (0-9; POSIX `zip` only —
				// Compress-Archive has no numeric equivalent). Clamp to a valid flag.
				const level = Math.min(9, Math.max(0, Math.trunc(compressionLevel)));
				execFileSync("zip", [`-${level}`, "-qr", zipPath, ...relFiles], { cwd: rootDirectory, stdio: "pipe" });
			}
			return zipPath;
		},
		catch: (error) =>
			new ArtifactError({
				operation: "upload",
				artifact,
				reason: `Failed to create zip: ${error instanceof Error ? error.message : String(error)}`,
			}),
	});

/** Extract a zip archive to `targetDir`. */
const extractZip = (zipPath: string, targetDir: string, artifact: string) =>
	Effect.try({
		try: () => {
			mkdirSync(targetDir, { recursive: true });
			if (process.platform === "win32") {
				const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}', '${targetDir.replace(/'/g, "''")}')`;
				try {
					execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", psCommand], { stdio: "pipe" });
				} catch {
					execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], { stdio: "pipe" });
				}
			} else {
				execFileSync("unzip", ["-oq", zipPath, "-d", targetDir], { stdio: "pipe" });
			}
		},
		catch: (error) =>
			new ArtifactError({
				operation: "download",
				artifact,
				reason: `Failed to extract zip: ${error instanceof Error ? error.message : String(error)}`,
			}),
	});

/**
 * Compute the SHA-256 hex digest over the zip file.
 *
 * @remarks
 * The v2 backend's `FinalizeArtifact` expects `hash: "sha256:<hex>"` over the
 * uploaded bytes — NOT a CRC64 (confirmed against `actions/toolkit`
 * `artifact/src/internal/upload/blob-upload.ts`, which hashes the upload stream
 * via `crypto.createHash('sha256')` and `.setEncoding('hex')`). Because the
 * Azure SDK upload is opaque, we hash the same on-disk zip independently.
 */
const sha256OfFile = (filePath: string, artifact: string) =>
	Effect.tryPromise({
		try: async () => {
			const hash = createHash("sha256");
			await pipeline(createReadStream(filePath), hash);
			return hash.digest("hex");
		},
		catch: (error) =>
			new ArtifactError({
				operation: "upload",
				artifact,
				reason: `Failed to hash zip: ${error instanceof Error ? error.message : String(error)}`,
			}),
	});

const cleanupFile = (filePath: string) =>
	Effect.sync(() => {
		try {
			unlinkSync(filePath);
		} catch {
			// Ignore cleanup errors.
		}
	});

const findByName = (artifacts: ReadonlyArray<ArtifactItem>, name: string): Option.Option<ArtifactItem> =>
	Option.fromNullable(artifacts.find((a) => a.name === name));

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

/**
 * Live implementation of {@link Artifact} using the V2 Twirp artifact protocol
 * and Azure Blob Storage for uploads/downloads.
 *
 * @remarks
 * Requires {@link HttpClient.HttpClient} for the Twirp RPCs; the
 * `ActionsRuntime.Default` / `Action.run` path provides it via
 * `FetchHttpClient.layer`. The `findBy` (cross-run/cross-repo REST) path is not
 * yet implemented and fails with a clear `ArtifactError`.
 *
 * The artifact backend is an internal GitHub protocol reverse-engineered from
 * `actions/toolkit`; it must be validated against a live GitHub-hosted runner
 * before relying on it.
 *
 * @public
 */
export const ArtifactLive: Layer.Layer<Artifact, never, HttpClient.HttpClient> = Layer.effect(
	Artifact,
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;

		const findByUnsupported = (operation: ArtifactOperation, artifact: string) =>
			Effect.fail(
				new ArtifactError({
					operation,
					artifact,
					reason: "Cross-run/cross-repo findBy via the public REST API is not yet implemented",
				}),
			);

		const listInternal = (
			baseUrl: string,
			token: Redacted.Redacted<string>,
			backendIds: BackendIds,
			artifact: string,
		) =>
			Effect.gen(function* () {
				const result = yield* twirpCall<ListArtifactsResponse>(
					http,
					baseUrl,
					token,
					"ListArtifacts",
					{ ...backendIds },
					"list",
					artifact,
				).pipe(Effect.retry(RETRY_SCHEDULE));
				if (result === CONFLICT) {
					return [] as ReadonlyArray<ArtifactItem>;
				}
				return (result.artifacts ?? []).map(toArtifactItem);
			});

		return {
			uploadArtifact: (name, files, rootDirectory, options) =>
				Effect.gen(function* () {
					if (options?.retentionDays !== undefined && options.retentionDays <= 0) {
						return yield* Effect.fail(
							new ArtifactError({ operation: "upload", artifact: name, reason: "retentionDays must be positive" }),
						);
					}
					const { baseUrl, token, backendIds } = yield* getArtifactEnv("upload", name);

					return yield* Effect.acquireUseRelease(
						createZip(files, rootDirectory, name, options?.compressionLevel),
						(zipPath) =>
							Effect.gen(function* () {
								// Step 1: CreateArtifact.
								const createResult = yield* twirpCall<CreateArtifactResponse>(
									http,
									baseUrl,
									token,
									"CreateArtifact",
									{ ...backendIds, name, version: ARTIFACT_VERSION, mimeType: "application/zip" },
									"upload",
									name,
								).pipe(Effect.retry(RETRY_SCHEDULE));

								// v2 forbids re-uploading the same name in a run; the backend
								// signals this via HTTP 409 (CONFLICT) or ok:false.
								if (createResult === CONFLICT || !createResult.ok) {
									return yield* Effect.fail(
										new ArtifactError({
											operation: "upload",
											artifact: name,
											reason: "CreateArtifact failed: artifact already exists or was rejected",
										}),
									);
								}
								const uploadUrl = pickSignedUploadUrl(createResult);
								if (!uploadUrl) {
									return yield* Effect.fail(
										new ArtifactError({
											operation: "upload",
											artifact: name,
											reason: "CreateArtifact did not return a signed upload URL",
										}),
									);
								}

								// Step 2: upload the zip to the Azure block blob.
								yield* Effect.tryPromise({
									try: async () => {
										const client = new BlockBlobClient(uploadUrl);
										await client.uploadFile(zipPath, {
											blockSize: UPLOAD_CHUNK_SIZE,
											concurrency: UPLOAD_CONCURRENCY,
											maxSingleShotSize: UPLOAD_MAX_SINGLE_SHOT,
										});
									},
									catch: (error) =>
										new ArtifactError({
											operation: "upload",
											artifact: name,
											reason: `Artifact upload failed: ${error instanceof Error ? error.message : String(error)}`,
										}),
								});

								// Step 3: size + sha256, then FinalizeArtifact.
								const size = yield* Effect.try({
									try: () => statSync(zipPath).size,
									catch: (error) =>
										new ArtifactError({
											operation: "upload",
											artifact: name,
											reason: `Failed to stat zip: ${error instanceof Error ? error.message : String(error)}`,
										}),
								});
								const sha256 = yield* sha256OfFile(zipPath, name);

								const finalizeResult = yield* twirpCall<FinalizeArtifactResponse>(
									http,
									baseUrl,
									token,
									"FinalizeArtifact",
									{
										...backendIds,
										name,
										size: String(size),
										hash: `sha256:${sha256}`,
										// Forward retentionDays as the backend's `expiresAt` (ISO), matching
										// @actions/artifact; omitted leaves the repo-default retention.
										...(options?.retentionDays !== undefined
											? { expiresAt: new Date(Date.now() + options.retentionDays * 86_400_000).toISOString() }
											: {}),
									},
									"upload",
									name,
								).pipe(Effect.retry(RETRY_SCHEDULE));

								if (finalizeResult === CONFLICT || !finalizeResult.ok) {
									return yield* Effect.fail(
										new ArtifactError({
											operation: "upload",
											artifact: name,
											reason: "FinalizeArtifact did not confirm success",
										}),
									);
								}
								const id = Number(pickArtifactId(finalizeResult) ?? 0);
								return { id, size };
							}),
						(zipPath) => cleanupFile(zipPath),
					);
				}),

			listArtifacts: (findBy) =>
				findBy
					? findByUnsupported("list", "*")
					: Effect.gen(function* () {
							const { baseUrl, token, backendIds } = yield* getArtifactEnv("list", "*");
							return yield* listInternal(baseUrl, token, backendIds, "*");
						}),

			getArtifact: (name, findBy) =>
				findBy
					? findByUnsupported("get", name)
					: Effect.gen(function* () {
							const { baseUrl, token, backendIds } = yield* getArtifactEnv("get", name);
							const artifacts = yield* listInternal(baseUrl, token, backendIds, name);
							return findByName(artifacts, name);
						}),

			downloadArtifact: (artifactId, options, findBy) =>
				findBy
					? findByUnsupported("download", String(artifactId))
					: Effect.gen(function* () {
							const idStr = String(artifactId);
							const { baseUrl, token, backendIds } = yield* getArtifactEnv("download", idStr);

							// Resolve the artifact name from its id via ListArtifacts.
							const artifacts = yield* listInternal(baseUrl, token, backendIds, idStr);
							const match = artifacts.find((a) => a.id === artifactId);
							if (!match) {
								return yield* Effect.fail(
									new ArtifactError({
										operation: "download",
										artifact: idStr,
										reason: `Artifact not found in the current run: id ${artifactId}`,
									}),
								);
							}

							const signedResult = yield* twirpCall<GetSignedArtifactURLResponse>(
								http,
								baseUrl,
								token,
								"GetSignedArtifactURL",
								{ ...backendIds, name: match.name },
								"download",
								idStr,
							).pipe(Effect.retry(RETRY_SCHEDULE));
							if (signedResult === CONFLICT) {
								return yield* Effect.fail(
									new ArtifactError({
										operation: "download",
										artifact: idStr,
										reason: "GetSignedArtifactURL returned a conflict",
									}),
								);
							}
							const downloadUrl = pickSignedDownloadUrl(signedResult);
							if (!downloadUrl) {
								return yield* Effect.fail(
									new ArtifactError({
										operation: "download",
										artifact: idStr,
										reason: "GetSignedArtifactURL did not return a signed URL",
									}),
								);
							}

							const targetDir = options?.path ?? join(tmpdir(), `artifact-download-${randomUUID()}`);
							const zipPath = join(tmpdir(), `artifact-download-${randomUUID()}.zip`);

							yield* Effect.acquireUseRelease(
								Effect.tryPromise({
									try: async () => {
										const client = new BlobClient(downloadUrl);
										await client.downloadToFile(zipPath);
										return zipPath;
									},
									catch: (error) =>
										new ArtifactError({
											operation: "download",
											artifact: idStr,
											reason: `Artifact download failed: ${error instanceof Error ? error.message : String(error)}`,
										}),
								}),
								(downloadedZip) => extractZip(downloadedZip, targetDir, idStr),
								(downloadedZip) => cleanupFile(downloadedZip),
							);

							return { downloadPath: targetDir };
						}),

			deleteArtifact: (name, findBy) =>
				findBy
					? findByUnsupported("delete", name)
					: Effect.gen(function* () {
							const { baseUrl, token, backendIds } = yield* getArtifactEnv("delete", name);

							const artifacts = yield* listInternal(baseUrl, token, backendIds, name);
							const match = findByName(artifacts, name);
							if (Option.isNone(match)) {
								return yield* Effect.fail(
									new ArtifactError({
										operation: "delete",
										artifact: name,
										reason: `Artifact not found in the current run: ${name}`,
									}),
								);
							}

							const deleteResult = yield* twirpCall<DeleteArtifactResponse>(
								http,
								baseUrl,
								token,
								"DeleteArtifact",
								{ ...backendIds, name },
								"delete",
								name,
							).pipe(Effect.retry(RETRY_SCHEDULE));
							if (deleteResult === CONFLICT) {
								return yield* Effect.fail(
									new ArtifactError({
										operation: "delete",
										artifact: name,
										reason: "DeleteArtifact returned a conflict",
									}),
								);
							}
							const id = Number(pickDeleteArtifactId(deleteResult) ?? match.value.id);
							return { id };
						}),
		};
	}),
);
