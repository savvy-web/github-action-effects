import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobClient, BlockBlobClient } from "@azure/storage-blob";
import { HttpClient } from "@effect/platform";
import { Effect, Layer, Option, Redacted } from "effect";
import { ActionCacheError } from "../errors/ActionCacheError.js";
import { ActionCache } from "../services/ActionCache.js";
import { UPLOAD_CHUNK_SIZE, UPLOAD_CONCURRENCY, UPLOAD_MAX_SINGLE_SHOT } from "./internal/azureUpload.js";
import { resolvePaths } from "./internal/globPaths.js";
import { CONFLICT, makeTwirpRetrySchedule, twirpCall as twirpCallShared } from "./internal/twirp.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWIRP_SERVICE = "github.actions.results.api.v1.CacheService";
const COMPRESSION_METHOD = "gzip";
const VERSION_SALT = "1.0";

// Retry config for Twirp RPC (shared with ArtifactLive via internal/twirp.ts).
const RETRY_SCHEDULE = makeTwirpRetrySchedule((error: ActionCacheError) => error.reason);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the cache version hash to match the actions/cache format.
 * Hash of: paths joined with "|", then "|gzip|1.0"
 * Does NOT sort paths (matches upstream behavior).
 */
const computeVersion = (paths: ReadonlyArray<string>): string => {
	const components = [...paths, COMPRESSION_METHOD, VERSION_SALT];
	return createHash("sha256").update(components.join("|")).digest("hex");
};

/**
 * Read cache protocol env vars. Uses ACTIONS_RESULTS_URL for V2.
 */
const getCacheEnv = (operation: "save" | "restore", key: string) =>
	Effect.try({
		try: () => {
			const resultsUrl = process.env.ACTIONS_RESULTS_URL;
			const token = process.env.ACTIONS_RUNTIME_TOKEN;
			if (!resultsUrl || !token) {
				throw new Error(
					`Missing required env vars: ${[!resultsUrl && "ACTIONS_RESULTS_URL", !token && "ACTIONS_RUNTIME_TOKEN"].filter(Boolean).join(", ")}`,
				);
			}
			const baseUrl = resultsUrl.endsWith("/") ? resultsUrl : `${resultsUrl}/`;
			// Hold the runtime token redacted; it is unwrapped only inside the
			// HttpClient request builder.
			return { baseUrl, token: Redacted.make(token) };
		},
		catch: (error) =>
			new ActionCacheError({
				key,
				operation,
				reason: error instanceof Error ? error.message : String(error),
			}),
	});

/**
 * Make a Twirp RPC call against the cache service via the shared client.
 * Returns the {@link CONFLICT} sentinel on HTTP 409 instead of failing,
 * allowing callers to treat "already exists" as a success. The error `reason`
 * substrings are preserved by `twirpCallShared` so the retry schedule and the
 * existing test assertions continue to match.
 */
const twirpCall = <T>(
	http: HttpClient.HttpClient,
	baseUrl: string,
	token: Redacted.Redacted<string>,
	method: string,
	body: Record<string, unknown>,
	operation: "save" | "restore",
	key: string,
) =>
	twirpCallShared<T, ActionCacheError>(
		http,
		baseUrl,
		TWIRP_SERVICE,
		token,
		method,
		body,
		(reason) => new ActionCacheError({ key, operation, reason }),
	);

/**
 * Create a tar.gz archive of the given paths.
 * Glob patterns are expanded to real paths before invoking tar.
 */
const createArchive = (paths: ReadonlyArray<string>, key: string) =>
	Effect.try({
		try: () => {
			const resolved = resolvePaths(paths);
			if (resolved.length === 0) {
				throw new Error("No files matched the provided cache paths");
			}
			const archivePath = join(tmpdir(), `cache-${randomUUID()}.tar.gz`);
			// -P (absolute-names) preserves leading "/" so absolute paths are
			// stored verbatim and later extracted to their correct locations.
			execFileSync("tar", ["czPf", archivePath, ...resolved], { stdio: "pipe" });
			return archivePath;
		},
		catch: (error) =>
			new ActionCacheError({
				key,
				operation: "save",
				reason: `Failed to create archive: ${error instanceof Error ? error.message : String(error)}`,
			}),
	});

/**
 * Extract a tar.gz archive.
 * Uses `-P` (absolute-names) to restore absolute paths to their correct
 * locations instead of extracting them relative to the working directory.
 * Uses `-k` (keep old files) on Windows to skip locked files rather than
 * fail with "Permission denied" when file handles are held.
 * The `-k` flag causes tar to exit non-zero when files are skipped, so
 * we tolerate exit code 1 (non-fatal warnings) but fail on exit code 2+.
 */
const extractArchive = (archivePath: string, key: string) =>
	Effect.try({
		try: () => {
			try {
				// -P (absolute-names) restores absolute paths to their original locations.
				// Windows: also use -k to skip locked files instead of failing with "Permission denied"
				// Linux/macOS: no -k, overwrite existing files (default behavior)
				const flags = process.platform === "win32" ? "xzPkf" : "xzPf";
				execFileSync("tar", [flags, archivePath], { stdio: "pipe" });
			} catch (err: unknown) {
				const code = (err as { status?: number }).status;
				// Exit code 1 = non-fatal (e.g. "file exists, not overwritten")
				// Exit code 2+ = fatal error
				if (code !== undefined && code >= 2) {
					throw err;
				}
			}
		},
		catch: (error) =>
			new ActionCacheError({
				key,
				operation: "restore",
				reason: `Failed to extract archive: ${error instanceof Error ? error.message : String(error)}`,
			}),
	});

/**
 * Clean up a temporary file, ignoring errors.
 */
const cleanupFile = (filePath: string) =>
	Effect.sync(() => {
		try {
			unlinkSync(filePath);
		} catch {
			// Ignore cleanup errors
		}
	});

// ---------------------------------------------------------------------------
// Twirp response types
// ---------------------------------------------------------------------------

interface GetCacheEntryResponse {
	readonly ok: boolean;
	readonly signed_download_url?: string;
	readonly matched_key?: string;
}

interface CreateCacheEntryResponse {
	readonly ok: boolean;
	readonly signed_upload_url?: string;
}

interface FinalizeCacheEntryResponse {
	readonly ok: boolean;
	readonly entry_id?: string;
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

/**
 * Live implementation of ActionCache using the V2 Twirp cache protocol
 * and Azure Blob Storage for uploads/downloads.
 *
 * Requires {@link HttpClient.HttpClient} for the Twirp RPCs; the
 * `ActionsRuntime.Default` / `Action.run` path provides it via
 * `FetchHttpClient.layer`. Manual-wiring consumers must provide it themselves.
 *
 * @public
 */
export const ActionCacheLive: Layer.Layer<ActionCache, never, HttpClient.HttpClient> = Layer.effect(
	ActionCache,
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;
		return {
			save: (paths, key) =>
				Effect.gen(function* () {
					const { baseUrl, token } = yield* getCacheEnv("save", key);
					const version = computeVersion(paths);

					yield* Effect.acquireUseRelease(
						createArchive(paths, key),
						(archivePath) =>
							Effect.gen(function* () {
								const archiveSize = yield* Effect.try({
									try: () => statSync(archivePath).size,
									catch: (error) =>
										new ActionCacheError({
											key,
											operation: "save",
											reason: `Failed to stat archive: ${error instanceof Error ? error.message : String(error)}`,
										}),
								});

								// Step 1: Create cache entry
								const createResult = yield* twirpCall<CreateCacheEntryResponse>(
									http,
									baseUrl,
									token,
									"CreateCacheEntry",
									{ key, version },
									"save",
									key,
								).pipe(Effect.retry(RETRY_SCHEDULE));

								// HTTP 409 = cache already exists for this key — treat as success
								if (createResult === CONFLICT) {
									return;
								}

								if (!createResult.ok || !createResult.signed_upload_url) {
									return yield* Effect.fail(
										new ActionCacheError({
											key,
											operation: "save",
											reason: "CreateCacheEntry did not return a signed upload URL",
										}),
									);
								}

								// Step 2: Upload archive to signed URL via Azure SDK
								yield* Effect.tryPromise({
									try: async () => {
										const client = new BlockBlobClient(createResult.signed_upload_url as string);
										await client.uploadFile(archivePath, {
											blockSize: UPLOAD_CHUNK_SIZE,
											concurrency: UPLOAD_CONCURRENCY,
											maxSingleShotSize: UPLOAD_MAX_SINGLE_SHOT,
										});
									},
									catch: (error) =>
										new ActionCacheError({
											key,
											operation: "save",
											reason: `Archive upload failed: ${error instanceof Error ? error.message : String(error)}`,
										}),
								});

								// Step 3: Finalize cache entry
								const finalizeResult = yield* twirpCall<FinalizeCacheEntryResponse>(
									http,
									baseUrl,
									token,
									"FinalizeCacheEntryUpload",
									{ key, version, size_bytes: String(archiveSize) },
									"save",
									key,
								).pipe(Effect.retry(RETRY_SCHEDULE));

								if (finalizeResult === CONFLICT || !finalizeResult.ok) {
									return yield* Effect.fail(
										new ActionCacheError({
											key,
											operation: "save",
											reason: "FinalizeCacheEntryUpload did not confirm success",
										}),
									);
								}
							}),
						(archivePath) => cleanupFile(archivePath),
					);
				}),

			restore: (paths, primaryKey, restoreKeys = []) =>
				Effect.gen(function* () {
					const { baseUrl, token } = yield* getCacheEnv("restore", primaryKey);
					const version = computeVersion(paths);

					// Step 1: Look up cache entry
					const lookupResult = yield* twirpCall<GetCacheEntryResponse>(
						http,
						baseUrl,
						token,
						"GetCacheEntryDownloadURL",
						{ key: primaryKey, restore_keys: [...restoreKeys], version },
						"restore",
						primaryKey,
					).pipe(Effect.retry(RETRY_SCHEDULE));

					if (lookupResult === CONFLICT || !lookupResult.ok || !lookupResult.signed_download_url) {
						return Option.none<string>();
					}

					// Step 2: Download archive from signed URL via Azure SDK
					const archivePath = join(tmpdir(), `cache-restore-${randomUUID()}.tar.gz`);

					yield* Effect.acquireUseRelease(
						Effect.tryPromise({
							try: async () => {
								const client = new BlobClient(lookupResult.signed_download_url as string);
								await client.downloadToFile(archivePath);
								return archivePath;
							},
							catch: (error) =>
								new ActionCacheError({
									key: primaryKey,
									operation: "restore",
									reason: `Archive download failed: ${error instanceof Error ? error.message : String(error)}`,
								}),
						}),
						(downloadedPath) => extractArchive(downloadedPath, primaryKey),
						(downloadedPath) => cleanupFile(downloadedPath),
					);

					return Option.some(lookupResult.matched_key ?? primaryKey);
				}),
		};
	}),
);
