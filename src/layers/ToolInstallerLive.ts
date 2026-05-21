import type { SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, stat, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Effect, Layer, Option, Schedule } from "effect";
import { ToolInstallerError } from "../errors/ToolInstallerError.js";
import { ToolInstaller } from "../services/ToolInstaller.js";

const TOOL_CACHE_DIR = process.env.RUNNER_TOOL_CACHE ?? join(tmpdir(), "runner-tool-cache");

const toolCachePath = (tool: string, version: string): string => join(TOOL_CACHE_DIR, tool, version, process.arch);

const makeTempDir = (): Effect.Effect<string, ToolInstallerError> =>
	Effect.tryPromise({
		try: async () => {
			const dir = join(tmpdir(), `tool-installer-${randomUUID()}`);
			await mkdir(dir, { recursive: true });
			return dir;
		},
		catch: (error) =>
			new ToolInstallerError({
				tool: "unknown",
				version: "unknown",
				operation: "extract",
				reason: `Failed to create temp directory: ${error instanceof Error ? error.message : String(error)}`,
			}),
	});

const spawnEffect = (
	command: string,
	args: ReadonlyArray<string>,
	operation: "extract",
	tool: string,
): Effect.Effect<void, ToolInstallerError> =>
	Effect.async<void, ToolInstallerError>((resume) => {
		const spawnOpts: SpawnOptions = { stdio: "pipe" };
		const child = spawn(command, [...args], spawnOpts);

		let stderr = "";

		(child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("error", (err: Error) => {
			resume(
				Effect.fail(
					new ToolInstallerError({
						tool,
						version: "unknown",
						operation,
						reason: `${command} failed to spawn: ${err.message}`,
					}),
				),
			);
		});

		child.on("close", (code: number | null) => {
			if (code === 0) {
				resume(Effect.void);
			} else {
				resume(
					Effect.fail(
						new ToolInstallerError({
							tool,
							version: "unknown",
							operation,
							reason: `${command} exited with code ${code ?? 1}: ${stderr}`.trim(),
						}),
					),
				);
			}
		});

		// On interruption (timeout/race/Fiber.interrupt), SIGTERM the extraction
		// child so it is not leaked. Safe no-op if the process already exited;
		// only runs on interrupt, not on a normal close.
		return Effect.sync(() => {
			child.kill();
		});
	});

const SOCKET_TIMEOUT_MS = 180_000; // 3 minutes, matches @actions/tool-cache
const MAX_REDIRECTS = 10;
const USER_AGENT = "github-action-effects";

const httpRequest = (url: string, redirectCount = 0): Effect.Effect<string, ToolInstallerError> =>
	Effect.async<string, ToolInstallerError>((resume) => {
		// Hoisted so the interruption finalizer can clean up a partial download.
		let tempFile: string | undefined;
		if (redirectCount > MAX_REDIRECTS) {
			resume(
				Effect.fail(
					new ToolInstallerError({
						tool: "unknown",
						version: "unknown",
						operation: "download",
						reason: `Too many redirects (>${MAX_REDIRECTS}) for ${url}`,
					}),
				),
			);
			return;
		}

		const parsedUrl = new URL(url);
		const get = parsedUrl.protocol === "https:" ? httpsGet : httpGet;

		const req = get(url, { headers: { "User-Agent": USER_AGENT } }, (response: IncomingMessage) => {
			const statusCode = response.statusCode ?? 0;

			if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
				response.resume();
				req.removeAllListeners("error");
				const resolvedLocation = new URL(response.headers.location as string, url).toString();
				resume(Effect.suspend(() => httpRequest(resolvedLocation, redirectCount + 1)));
				return;
			}

			if (statusCode < 200 || statusCode >= 300) {
				response.resume();
				resume(
					Effect.fail(
						new ToolInstallerError({
							tool: "unknown",
							version: "unknown",
							operation: "download",
							reason: `Failed to download ${url}: HTTP ${statusCode}`,
							statusCode,
						}),
					),
				);
				return;
			}

			tempFile = join(tmpdir(), `download-${randomUUID()}`);
			const downloadTarget = tempFile;
			const writeStream = createWriteStream(downloadTarget);
			pipeline(response, writeStream)
				.then(() => resume(Effect.succeed(downloadTarget)))
				.catch((error: unknown) => {
					unlink(downloadTarget).catch(() => {});
					resume(
						Effect.fail(
							new ToolInstallerError({
								tool: "unknown",
								version: "unknown",
								operation: "download",
								reason: `Failed to download ${url}: ${error instanceof Error ? error.message : String(error)}`,
							}),
						),
					);
				});
		});

		req.setTimeout(SOCKET_TIMEOUT_MS, () => {
			req.destroy(new Error(`Socket timeout after ${SOCKET_TIMEOUT_MS}ms`));
		});

		req.on("error", (error: Error) => {
			resume(
				Effect.fail(
					new ToolInstallerError({
						tool: "unknown",
						version: "unknown",
						operation: "download",
						reason: `Failed to download ${url}: ${error.message}`,
					}),
				),
			);
		});

		// On interruption: abort the in-flight request socket and remove any
		// partial download. `unlink` ENOENT (file never created) is swallowed.
		// Each recursive redirect hop is its own `Effect.async` with its own
		// finalizer, so a mid-redirect interrupt still aborts that hop's `req`.
		return Effect.sync(() => {
			req.destroy();
			if (tempFile !== undefined) {
				void unlink(tempFile).catch(() => {});
			}
		});
	});

/**
 * Predicate gating the `download` retry schedule: a `ToolInstallerError` is
 * retryable when its HTTP status is 5xx / 408 / 429, or (for transport faults
 * with no status) when its reason names a known transient network error.
 *
 * Extracted as a pure function so the backoff timing can be exercised under
 * `TestClock` without standing up a `node:https` mock (see Q3 in the WS3 spec).
 *
 * @internal
 */
export const isRetryableDownloadError = (error: ToolInstallerError): boolean => {
	if (error.statusCode !== undefined) {
		return error.statusCode >= 500 || error.statusCode === 408 || error.statusCode === 429;
	}
	return (
		error.reason.includes("Socket timeout") ||
		error.reason.includes("ECONNRESET") ||
		error.reason.includes("ECONNREFUSED") ||
		error.reason.includes("ETIMEDOUT")
	);
};

/**
 * Live implementation of ToolInstaller using `node:https`/`node:http`,
 * `node:child_process`, and `node:fs/promises`. No `@actions/tool-cache` dependency.
 *
 * @public
 */
export const ToolInstallerLive: Layer.Layer<ToolInstaller> = Layer.succeed(ToolInstaller, {
	find: (tool: string, version: string) =>
		Effect.tryPromise({
			try: () => stat(toolCachePath(tool, version)),
			catch: () => null,
		}).pipe(
			Effect.map((s) => (s?.isDirectory() ? Option.some(toolCachePath(tool, version)) : Option.none())),
			Effect.catchAll(() => Effect.succeed(Option.none())),
		),

	download: (url: string) =>
		httpRequest(url).pipe(
			Effect.retry(
				Schedule.intersect(Schedule.exponential("1 second"), Schedule.recurs(2)).pipe(
					Schedule.whileInput(isRetryableDownloadError),
				),
			),
		),

	extractTar: (file: string, dest?: string, flags?: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			const targetDir = dest ?? (yield* makeTempDir());
			if (dest) {
				yield* Effect.tryPromise({
					try: () => mkdir(dest, { recursive: true }),
					catch: (error) =>
						new ToolInstallerError({
							tool: "unknown",
							version: "unknown",
							operation: "extract",
							reason: `Failed to create destination directory: ${error instanceof Error ? error.message : String(error)}`,
						}),
				});
			}
			const tarFlags = flags && flags.length > 0 ? [...flags] : ["xzf"];
			const args = [...tarFlags, file, "-C", targetDir];
			yield* spawnEffect("tar", args, "extract", "unknown");
			return targetDir;
		}),

	extractZip: (file: string, dest?: string) =>
		Effect.gen(function* () {
			const targetDir = dest ?? (yield* makeTempDir());
			if (dest) {
				yield* Effect.tryPromise({
					try: () => mkdir(dest, { recursive: true }),
					catch: (error) =>
						new ToolInstallerError({
							tool: "unknown",
							version: "unknown",
							operation: "extract",
							reason: `Failed to create destination directory: ${error instanceof Error ? error.message : String(error)}`,
						}),
				});
			}

			if (process.platform === "win32") {
				const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${file.replace(/'/g, "''")}', '${targetDir.replace(/'/g, "''")}')`;
				yield* spawnEffect("pwsh", ["-NoProfile", "-NonInteractive", "-Command", psCommand], "extract", "unknown").pipe(
					Effect.catchAll(() =>
						spawnEffect("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], "extract", "unknown"),
					),
				);
			} else {
				yield* spawnEffect("unzip", ["-oq", file, "-d", targetDir], "extract", "unknown");
			}

			return targetDir;
		}),

	cacheDir: (sourceDir: string, tool: string, version: string) =>
		Effect.tryPromise({
			try: async () => {
				const dest = toolCachePath(tool, version);
				await mkdir(dest, { recursive: true });
				await cp(sourceDir, dest, { recursive: true });
				return dest;
			},
			catch: (error) =>
				new ToolInstallerError({
					tool,
					version,
					operation: "cache",
					reason: `Failed to cache directory: ${error instanceof Error ? error.message : String(error)}`,
				}),
		}),

	cacheFile: (sourceFile: string, targetFile: string, tool: string, version: string) =>
		Effect.tryPromise({
			try: async () => {
				const dest = toolCachePath(tool, version);
				await mkdir(dest, { recursive: true });
				await cp(sourceFile, join(dest, targetFile));
				return dest;
			},
			catch: (error) =>
				new ToolInstallerError({
					tool,
					version,
					operation: "cache",
					reason: `Failed to cache file: ${error instanceof Error ? error.message : String(error)}`,
				}),
		}),
});
