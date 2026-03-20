import type { SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Effect, Layer, Option } from "effect";
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
	});

/**
 * Live implementation of ToolInstaller using native `fetch`, `node:child_process`,
 * and `node:fs/promises`. No `@actions/tool-cache` dependency.
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
		Effect.tryPromise({
			try: async () => {
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status} ${response.statusText}`);
				}
				if (!response.body) {
					throw new Error("Response body is empty");
				}
				const tempFile = join(tmpdir(), `download-${randomUUID()}`);
				const writeStream = createWriteStream(tempFile);
				await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), writeStream);
				return tempFile;
			},
			catch: (error) =>
				new ToolInstallerError({
					tool: "unknown",
					version: "unknown",
					operation: "download",
					reason: `Failed to download ${url}: ${error instanceof Error ? error.message : String(error)}`,
				}),
		}),

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
			yield* spawnEffect("unzip", [file, "-d", targetDir], "extract", "unknown");
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
