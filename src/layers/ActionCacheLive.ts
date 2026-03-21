import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Effect, Layer, Option } from "effect";
import { ActionCacheError } from "../errors/ActionCacheError.js";
import { ActionCache } from "../services/ActionCache.js";

/** Maximum chunk size for upload (32 MB). */
const MAX_CHUNK_SIZE = 32 * 1024 * 1024;

/** Common headers for cache API requests. */
const apiHeaders = (token: string) => ({
	Authorization: `Bearer ${token}`,
	Accept: "application/json;api-version=6.0-preview.1",
});

/**
 * Compute the version hash for a set of paths.
 * SHA256 of paths sorted and joined with `|`.
 */
const computeVersion = (paths: ReadonlyArray<string>): string => {
	const sorted = [...paths].sort();
	return createHash("sha256").update(sorted.join("|")).digest("hex");
};

/**
 * Read cache protocol env vars, failing with ActionCacheError if missing.
 */
const getCacheEnv = (operation: "save" | "restore", key: string) =>
	Effect.try({
		try: () => {
			const cacheUrl = process.env.ACTIONS_CACHE_URL;
			const token = process.env.ACTIONS_RUNTIME_TOKEN;
			if (!cacheUrl || !token) {
				throw new Error(
					`Missing required env vars: ${[!cacheUrl && "ACTIONS_CACHE_URL", !token && "ACTIONS_RUNTIME_TOKEN"].filter(Boolean).join(", ")}`,
				);
			}
			// Ensure trailing slash
			const baseUrl = cacheUrl.endsWith("/") ? cacheUrl : `${cacheUrl}/`;
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
 * Create a tar.gz archive of the given paths.
 * Returns the path to the temporary archive file.
 */
const createArchive = (paths: ReadonlyArray<string>, key: string) =>
	Effect.try({
		try: () => {
			const archivePath = join(tmpdir(), `cache-${randomUUID()}.tar.gz`);
			execFileSync("tar", ["czf", archivePath, ...paths], { stdio: "pipe" });
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

/**
 * Read a chunk from a file using a stream, avoiding loading the entire
 * file into memory. Returns a Buffer of the requested range.
 */
const readChunk = (filePath: string, start: number, length: number): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const stream = createReadStream(filePath, { start, end: start + length - 1 });
		stream.on("data", (chunk: Buffer) => chunks.push(chunk));
		stream.on("end", () => resolve(Buffer.concat(chunks)));
		stream.on("error", reject);
	});

/**
 * Upload the archive in chunks, streaming each chunk from disk.
 */
const uploadChunks = (
	baseUrl: string,
	token: string,
	cacheId: number,
	archivePath: string,
	archiveSize: number,
	key: string,
): Effect.Effect<void, ActionCacheError> =>
	Effect.gen(function* () {
		let offset = 0;

		while (offset < archiveSize) {
			const chunkEnd = Math.min(offset + MAX_CHUNK_SIZE, archiveSize);
			const chunkLength = chunkEnd - offset;

			const chunk = yield* Effect.tryPromise({
				try: () => readChunk(archivePath, offset, chunkLength),
				catch: (error) =>
					new ActionCacheError({
						key,
						operation: "save",
						reason: `Failed to read archive chunk: ${error instanceof Error ? error.message : String(error)}`,
					}),
			});

			const uploadResponse = yield* Effect.tryPromise({
				try: () =>
					fetch(`${baseUrl}_apis/artifactcache/caches/${cacheId}`, {
						method: "PATCH",
						headers: {
							...apiHeaders(token),
							"Content-Type": "application/octet-stream",
							"Content-Range": `bytes ${offset}-${chunkEnd - 1}/*`,
						},
						body: chunk,
					}),
				catch: (error) =>
					new ActionCacheError({
						key,
						operation: "save",
						reason: `Chunk upload failed: ${error instanceof Error ? error.message : String(error)}`,
					}),
			});

			if (!uploadResponse.ok) {
				return yield* Effect.fail(
					new ActionCacheError({
						key,
						operation: "save",
						reason: `Chunk upload failed with status ${uploadResponse.status}`,
					}),
				);
			}

			offset = chunkEnd;
		}
	});

export const ActionCacheLive: Layer.Layer<ActionCache> = Layer.succeed(ActionCache, {
	save: (paths, key) =>
		Effect.gen(function* () {
			const { baseUrl, token } = yield* getCacheEnv("save", key);
			const version = computeVersion(paths);

			// acquireUseRelease guarantees cleanup even on fiber interruption
			yield* Effect.acquireUseRelease(
				createArchive(paths, key),
				(archivePath) =>
					Effect.gen(function* () {
						const archiveSize = statSync(archivePath).size;

						// Step 1: Reserve cache
						const reserveResponse = yield* Effect.tryPromise({
							try: () =>
								fetch(`${baseUrl}_apis/artifactcache/caches`, {
									method: "POST",
									headers: {
										...apiHeaders(token),
										"Content-Type": "application/json",
									},
									body: JSON.stringify({ key, version, cacheSize: archiveSize }),
								}),
							catch: (error) =>
								new ActionCacheError({
									key,
									operation: "save",
									reason: `Cache reserve request failed: ${error instanceof Error ? error.message : String(error)}`,
								}),
						});

						if (!reserveResponse.ok) {
							const body = yield* Effect.tryPromise({
								try: () => reserveResponse.text(),
								catch: () =>
									new ActionCacheError({
										key,
										operation: "save",
										reason: `Cache reserve failed with status ${reserveResponse.status}`,
									}),
							});
							return yield* Effect.fail(
								new ActionCacheError({
									key,
									operation: "save",
									reason: `Cache reserve failed (${reserveResponse.status}): ${body}`,
								}),
							);
						}

						const reserveData = (yield* Effect.tryPromise({
							try: () => reserveResponse.json() as Promise<{ cacheId: number }>,
							catch: (error) =>
								new ActionCacheError({
									key,
									operation: "save",
									reason: `Failed to parse reserve response: ${error instanceof Error ? error.message : String(error)}`,
								}),
						})) as { cacheId: number };

						// Step 2: Upload chunks (streamed from disk)
						yield* uploadChunks(baseUrl, token, reserveData.cacheId, archivePath, archiveSize, key);

						// Step 3: Commit cache
						const commitResponse = yield* Effect.tryPromise({
							try: () =>
								fetch(`${baseUrl}_apis/artifactcache/caches/${reserveData.cacheId}`, {
									method: "POST",
									headers: {
										...apiHeaders(token),
										"Content-Type": "application/json",
									},
									body: JSON.stringify({ size: archiveSize }),
								}),
							catch: (error) =>
								new ActionCacheError({
									key,
									operation: "save",
									reason: `Cache commit failed: ${error instanceof Error ? error.message : String(error)}`,
								}),
						});

						if (!commitResponse.ok) {
							return yield* Effect.fail(
								new ActionCacheError({
									key,
									operation: "save",
									reason: `Cache commit failed with status ${commitResponse.status}`,
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
			const keys = [primaryKey, ...restoreKeys].join(",");

			const response = yield* Effect.tryPromise({
				try: () =>
					fetch(
						`${baseUrl}_apis/artifactcache/cache?keys=${encodeURIComponent(keys)}&version=${encodeURIComponent(version)}`,
						{
							method: "GET",
							headers: apiHeaders(token),
						},
					),
				catch: (error) =>
					new ActionCacheError({
						key: primaryKey,
						operation: "restore",
						reason: `Cache lookup request failed: ${error instanceof Error ? error.message : String(error)}`,
					}),
			});

			// 204 or non-200 → cache miss
			if (response.status === 204) {
				return Option.none<string>();
			}

			if (!response.ok) {
				return yield* Effect.fail(
					new ActionCacheError({
						key: primaryKey,
						operation: "restore",
						reason: `Cache lookup failed with status ${response.status}`,
					}),
				);
			}

			const data = (yield* Effect.tryPromise({
				try: () => response.json() as Promise<{ archiveLocation?: string; cacheKey?: string }>,
				catch: (error) =>
					new ActionCacheError({
						key: primaryKey,
						operation: "restore",
						reason: `Failed to parse cache response: ${error instanceof Error ? error.message : String(error)}`,
					}),
			})) as { archiveLocation?: string; cacheKey?: string };

			if (!data.archiveLocation) {
				return Option.none<string>();
			}

			// Download archive to temp file, extract, clean up
			const archivePath = join(tmpdir(), `cache-restore-${randomUUID()}.tar.gz`);

			yield* Effect.acquireUseRelease(
				Effect.tryPromise({
					try: async () => {
						const downloadResponse = await fetch(data.archiveLocation as string);
						if (!downloadResponse.ok || !downloadResponse.body) {
							throw new Error(`Archive download failed with status ${downloadResponse.status}`);
						}
						const writer = createWriteStream(archivePath);
						await pipeline(Readable.fromWeb(downloadResponse.body as import("node:stream/web").ReadableStream), writer);
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

			return Option.some(data.cacheKey ?? primaryKey);
		}),
});
