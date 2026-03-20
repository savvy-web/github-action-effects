import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { ToolInstallerError } from "../errors/ToolInstallerError.js";

/**
 * Low-level service for downloading, extracting, and caching tool binaries.
 *
 * Provides primitives for tool cache management without opinionated
 * installation workflows. Consumers compose these primitives as needed.
 *
 * @public
 */
export class ToolInstaller extends Context.Tag("github-action-effects/ToolInstaller")<
	ToolInstaller,
	{
		/** Look up a cached tool by name and version. Returns the cached path if found. */
		readonly find: (tool: string, version: string) => Effect.Effect<Option.Option<string>>;

		/** Download a URL to a temporary file. Returns the temp file path. */
		readonly download: (url: string) => Effect.Effect<string, ToolInstallerError>;

		/** Extract a tar archive. Returns the directory containing extracted files. */
		readonly extractTar: (
			file: string,
			dest?: string,
			flags?: ReadonlyArray<string>,
		) => Effect.Effect<string, ToolInstallerError>;

		/** Extract a zip archive. Returns the directory containing extracted files. */
		readonly extractZip: (file: string, dest?: string) => Effect.Effect<string, ToolInstallerError>;

		/** Cache a directory as a tool at the given name and version. Returns the cached path. */
		readonly cacheDir: (sourceDir: string, tool: string, version: string) => Effect.Effect<string, ToolInstallerError>;

		/** Cache a single file as a tool at the given name and version. Returns the cached directory path. */
		readonly cacheFile: (
			sourceFile: string,
			targetFile: string,
			tool: string,
			version: string,
		) => Effect.Effect<string, ToolInstallerError>;
	}
>() {}
