import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { Effect, Layer } from "effect";
import { ToolInstallerError } from "../errors/ToolInstallerError.js";
import type { ToolInstallOptions } from "../services/ToolInstaller.js";
import { ToolInstaller } from "../services/ToolInstaller.js";

const extractArchive = (
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

/**
 * Live implementation of ToolInstaller using `@actions/tool-cache`.
 *
 * @public
 */
export const ToolInstallerLive: Layer.Layer<ToolInstaller> = Layer.succeed(ToolInstaller, {
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
					Effect.flatMap((downloadedPath) => extractArchive(downloadedPath, archiveType, name, version)),
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
			Effect.withSpan("ToolInstaller.install", { attributes: { tool: name, version, downloadUrl } }),
		),

	isCached: (name: string, version: string) =>
		Effect.sync(() => tc.find(name, version)).pipe(
			Effect.map((cached) => cached !== ""),
			Effect.catchAll(() => Effect.succeed(false)),
			Effect.catchAllDefect(() => Effect.succeed(false)),
			Effect.withSpan("ToolInstaller.isCached", { attributes: { tool: name, version } }),
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
					Effect.flatMap((downloadedPath) => extractArchive(downloadedPath, archiveType, name, version)),
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
			Effect.withSpan("ToolInstaller.installAndAddToPath", { attributes: { tool: name, version, downloadUrl } }),
		),
});
