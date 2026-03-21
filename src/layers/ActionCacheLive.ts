import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, globSync, statSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { BlobClient, BlockBlobClient } from "@azure/storage-blob";
import { Effect, Layer, Option, Schedule } from "effect";
import { ActionCacheError } from "../errors/ActionCacheError.js";
import { ActionCache } from "../services/ActionCache.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWIRP_PREFIX = "twirp/github.actions.results.api.v1.CacheService";
const COMPRESSION_METHOD = "gzip";
const VERSION_SALT = "1.0";

// Azure upload config (matches actions/cache)
const UPLOAD_CHUNK_SIZE = 64 * 1024 * 1024; // 64 MiB
const UPLOAD_CONCURRENCY = 8;
const UPLOAD_MAX_SINGLE_SHOT = 128 * 1024 * 1024; // 128 MiB

// Retry config for Twirp RPC
const RETRY_SCHEDULE = Schedule.intersect(Schedule.exponential("3 seconds", 1.5), Schedule.recurs(4)).pipe(
	Schedule.whileInput((error: ActionCacheError) => {
		const reason = error.reason;
		return (
			reason.includes("HTTP 500") ||
			reason.includes("HTTP 502") ||
			reason.includes("HTTP 503") ||
			reason.includes("HTTP 504") ||
			reason.includes("ECONNRESET") ||
			reason.includes("ECONNREFUSED") ||
			reason.includes("ETIMEDOUT")
		);
	}),
);

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
			return { baseUrl, token };
		},
		catch: (error) =>
			new ActionCacheError({
				key,
				operation,
				reason: error instanceof Error ? error.message : String(error),
			}),
	});

/**
 * Make a Twirp RPC call (POST with JSON body/response).
 */
const twirpCall = <T>(
	baseUrl: string,
	token: string,
	method: string,
	body: Record<string, unknown>,
	operation: "save" | "restore",
	key: string,
): Effect.Effect<T, ActionCacheError> =>
	Effect.tryPromise({
		try: async () => {
			const url = `${baseUrl}${TWIRP_PREFIX}/${method}`;
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(body),
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} from ${method}`);
			}
			return (await response.json()) as T;
		},
		catch: (error) =>
			new ActionCacheError({
				key,
				operation,
				reason: `${method} failed: ${error instanceof Error ? error.message : String(error)}`,
			}),
	});

/**
 * Check whether a path contains glob metacharacters (`*`, `?`, `[`).
 */
const hasGlobChars = (p: string): boolean => /[*?[]/.test(p);

/**
 * Resolve cache paths before passing to tar:
 * 1. Expand `~` prefix to the user's home directory
 * 2. Expand glob patterns (both relative and absolute) via `node:fs.globSync`
 * 3. Filter out paths that don't exist on disk
 * 4. Deduplicate entries where a parent directory already covers a child
 */
const resolvePaths = (paths: ReadonlyArray<string>): ReadonlyArray<string> => {
	const home = process.env.HOME || homedir();
	const expanded: string[] = [];

	for (const raw of paths) {
		// Step 1: Resolve tilde
		const p = raw.startsWith("~/") ? join(home, raw.slice(2)) : raw === "~" ? home : raw;

		// Step 2: Expand globs or keep literal paths
		if (hasGlobChars(p)) {
			expanded.push(...globSync(p));
		} else {
			expanded.push(p);
		}
	}

	// Step 3: Filter non-existent paths
	const existing = expanded.filter((p) => existsSync(p));

	// Step 4: Deduplicate — remove entries where a parent directory is already listed
	// Sort shortest-first so parents come before children
	const sorted = [...existing].sort((a, b) => a.length - b.length);
	const result: string[] = [];
	for (const p of sorted) {
		const coveredByParent = result.some((parent) => p.startsWith(`${parent}/`));
		if (!coveredByParent) {
			result.push(p);
		}
	}

	return result;
};

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
			execFileSync("tar", ["czf", archivePath, ...resolved], { stdio: "pipe" });
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
 */
const extractArchive = (archivePath: string, key: string) =>
	Effect.try({
		try: () => {
			execFileSync("tar", ["xzf", archivePath], { stdio: "pipe" });
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
 * @public
 */
export const ActionCacheLive: Layer.Layer<ActionCache> = Layer.succeed(ActionCache, {
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
						const createResponse = yield* twirpCall<CreateCacheEntryResponse>(
							baseUrl,
							token,
							"CreateCacheEntry",
							{ key, version },
							"save",
							key,
						).pipe(Effect.retry(RETRY_SCHEDULE));

						if (!createResponse.ok || !createResponse.signed_upload_url) {
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
								const client = new BlockBlobClient(createResponse.signed_upload_url as string);
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
						const finalizeResponse = yield* twirpCall<FinalizeCacheEntryResponse>(
							baseUrl,
							token,
							"FinalizeCacheEntryUpload",
							{ key, version, size_bytes: String(archiveSize) },
							"save",
							key,
						).pipe(Effect.retry(RETRY_SCHEDULE));

						if (!finalizeResponse.ok) {
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
			const lookupResponse = yield* twirpCall<GetCacheEntryResponse>(
				baseUrl,
				token,
				"GetCacheEntryDownloadURL",
				{ key: primaryKey, restore_keys: [...restoreKeys], version },
				"restore",
				primaryKey,
			).pipe(Effect.retry(RETRY_SCHEDULE));

			if (!lookupResponse.ok || !lookupResponse.signed_download_url) {
				return Option.none<string>();
			}

			// Step 2: Download archive from signed URL via Azure SDK
			const archivePath = join(tmpdir(), `cache-restore-${randomUUID()}.tar.gz`);

			yield* Effect.acquireUseRelease(
				Effect.tryPromise({
					try: async () => {
						const client = new BlobClient(lookupResponse.signed_download_url as string);
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

			return Option.some(lookupResponse.matched_key ?? primaryKey);
		}),
});
