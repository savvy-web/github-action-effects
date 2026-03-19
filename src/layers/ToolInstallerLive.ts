import { chmod } from "node:fs/promises";
import type { Context } from "effect";
import { Effect, Layer } from "effect";
import { ToolInstallerError } from "../errors/ToolInstallerError.js";
import { ActionsCore } from "../services/ActionsCore.js";
import { ActionsToolCache } from "../services/ActionsToolCache.js";
import type { BinaryInstallOptions, ToolInstallOptions } from "../services/ToolInstaller.js";
import { ToolInstaller } from "../services/ToolInstaller.js";

const extractArchive = (
	tc: Context.Tag.Service<typeof ActionsToolCache>,
	downloadedPath: string,
	archiveType: "tar.gz" | "tar.xz" | "zip",
	tool: string,
	version: string,
): Effect.Effect<string, ToolInstallerError> => {
	switch (archiveType) {
		case "tar.gz":
			return Effect.tryPromise({
				try: () => tc.extractTar(downloadedPath),
				catch: (error) =>
					new ToolInstallerError({
						tool,
						version,
						operation: "extract",
						reason: `Failed to extract tar.gz: ${error instanceof Error ? error.message : String(error)}`,
					}),
			});
		case "tar.xz":
			return Effect.tryPromise({
				try: () => tc.extractTar(downloadedPath, undefined, "xJ"),
				catch: (error) =>
					new ToolInstallerError({
						tool,
						version,
						operation: "extract",
						reason: `Failed to extract tar.xz: ${error instanceof Error ? error.message : String(error)}`,
					}),
			});
		case "zip":
			return Effect.tryPromise({
				try: () => tc.extractZip(downloadedPath),
				catch: (error) =>
					new ToolInstallerError({
						tool,
						version,
						operation: "extract",
						reason: `Failed to extract zip: ${error instanceof Error ? error.message : String(error)}`,
					}),
			});
	}
};

const installBinaryCore = (
	tc: Context.Tag.Service<typeof ActionsToolCache>,
	name: string,
	version: string,
	downloadUrl: string,
	options?: BinaryInstallOptions,
): Effect.Effect<string, ToolInstallerError> =>
	Effect.sync(() => tc.find(name, version)).pipe(
		Effect.flatMap((cached) => {
			if (cached) {
				return Effect.succeed(cached);
			}

			const binaryName = options?.binaryName ?? name;

			return Effect.tryPromise({
				try: () => tc.downloadTool(downloadUrl),
				catch: (error) =>
					new ToolInstallerError({
						tool: name,
						version,
						operation: "download",
						reason: `Failed to download tool: ${error instanceof Error ? error.message : String(error)}`,
					}),
			}).pipe(
				Effect.flatMap((downloadedPath) =>
					Effect.tryPromise({
						try: () => tc.cacheFile(downloadedPath, binaryName, name, version),
						catch: (error) =>
							new ToolInstallerError({
								tool: name,
								version,
								operation: "cache",
								reason: `Failed to cache tool: ${error instanceof Error ? error.message : String(error)}`,
							}),
					}),
				),
				Effect.flatMap((cachedPath) => {
					if (options?.executable === false) {
						return Effect.succeed(cachedPath);
					}
					const binaryPath = `${cachedPath}/${binaryName}`;
					return Effect.tryPromise({
						try: () => chmod(binaryPath, 0o755),
						catch: (error) =>
							new ToolInstallerError({
								tool: name,
								version,
								operation: "chmod",
								reason: `Failed to chmod binary: ${error instanceof Error ? error.message : String(error)}`,
							}),
					}).pipe(Effect.as(cachedPath));
				}),
			);
		}),
	);

/**
 * Live implementation of ToolInstaller using `@actions/tool-cache`.
 *
 * @public
 */
export const ToolInstallerLive: Layer.Layer<ToolInstaller, never, ActionsCore | ActionsToolCache> = Layer.effect(
	ToolInstaller,
	Effect.gen(function* () {
		const core = yield* ActionsCore;
		const tc = yield* ActionsToolCache;

		return {
			install: (name: string, version: string, downloadUrl: string, options?: ToolInstallOptions) =>
				Effect.sync(() => tc.find(name, version)).pipe(
					Effect.flatMap((cached) => {
						if (cached) {
							const toolPath = options?.binSubPath ? `${cached}/${options.binSubPath}` : cached;
							return Effect.succeed(toolPath);
						}

						const archiveType = options?.archiveType ?? "tar.gz";

						return Effect.tryPromise({
							try: () => tc.downloadTool(downloadUrl),
							catch: (error) =>
								new ToolInstallerError({
									tool: name,
									version,
									operation: "download",
									reason: `Failed to download tool: ${error instanceof Error ? error.message : String(error)}`,
								}),
						}).pipe(
							Effect.flatMap((downloadedPath) => extractArchive(tc, downloadedPath, archiveType, name, version)),
							Effect.flatMap((extractedPath) =>
								Effect.tryPromise({
									try: () => tc.cacheDir(extractedPath, name, version),
									catch: (error) =>
										new ToolInstallerError({
											tool: name,
											version,
											operation: "cache",
											reason: `Failed to cache tool: ${error instanceof Error ? error.message : String(error)}`,
										}),
								}),
							),
							Effect.map((cachedPath) => (options?.binSubPath ? `${cachedPath}/${options.binSubPath}` : cachedPath)),
						);
					}),
				),

			isCached: (name: string, version: string) =>
				Effect.sync(() => tc.find(name, version)).pipe(
					Effect.map((cached) => cached !== ""),
					Effect.catchAll(() => Effect.succeed(false)),
					Effect.catchAllDefect(() => Effect.succeed(false)),
				),

			installAndAddToPath: (name: string, version: string, downloadUrl: string, options?: ToolInstallOptions) =>
				Effect.sync(() => tc.find(name, version)).pipe(
					Effect.flatMap((cached) => {
						if (cached) {
							const toolPath = options?.binSubPath ? `${cached}/${options.binSubPath}` : cached;
							return Effect.succeed(toolPath);
						}

						const archiveType = options?.archiveType ?? "tar.gz";

						return Effect.tryPromise({
							try: () => tc.downloadTool(downloadUrl),
							catch: (error) =>
								new ToolInstallerError({
									tool: name,
									version,
									operation: "download",
									reason: `Failed to download tool: ${error instanceof Error ? error.message : String(error)}`,
								}),
						}).pipe(
							Effect.flatMap((downloadedPath) => extractArchive(tc, downloadedPath, archiveType, name, version)),
							Effect.flatMap((extractedPath) =>
								Effect.tryPromise({
									try: () => tc.cacheDir(extractedPath, name, version),
									catch: (error) =>
										new ToolInstallerError({
											tool: name,
											version,
											operation: "cache",
											reason: `Failed to cache tool: ${error instanceof Error ? error.message : String(error)}`,
										}),
								}),
							),
							Effect.map((cachedPath) => (options?.binSubPath ? `${cachedPath}/${options.binSubPath}` : cachedPath)),
						);
					}),
					Effect.flatMap((toolPath) =>
						Effect.try({
							try: () => {
								core.addPath(toolPath);
								return toolPath;
							},
							catch: (error) =>
								new ToolInstallerError({
									tool: name,
									version,
									operation: "path",
									reason: `Failed to add to PATH: ${error instanceof Error ? error.message : String(error)}`,
								}),
						}),
					),
				),

			installBinary: (name: string, version: string, downloadUrl: string, options?: BinaryInstallOptions) =>
				installBinaryCore(tc, name, version, downloadUrl, options),

			installBinaryAndAddToPath: (name: string, version: string, downloadUrl: string, options?: BinaryInstallOptions) =>
				installBinaryCore(tc, name, version, downloadUrl, options).pipe(
					Effect.flatMap((cachedPath) =>
						Effect.try({
							try: () => {
								core.addPath(cachedPath);
								return cachedPath;
							},
							catch: (error) =>
								new ToolInstallerError({
									tool: name,
									version,
									operation: "path",
									reason: `Failed to add to PATH: ${error instanceof Error ? error.message : String(error)}`,
								}),
						}),
					),
				),
		};
	}),
);
