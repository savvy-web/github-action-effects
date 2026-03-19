import type { Effect } from "effect";
import { Context } from "effect";
import type { ToolInstallerError } from "../errors/ToolInstallerError.js";

/**
 * Options for binary tool installation.
 *
 * @public
 */
export interface BinaryInstallOptions {
	/** Name for the cached binary file. Defaults to the tool name. */
	readonly binaryName?: string;

	/** Set executable permission (chmod 0o755) on unix. Defaults to true. */
	readonly executable?: boolean;
}

/**
 * Options for tool installation.
 *
 * @public
 */
export interface ToolInstallOptions {
	/** Archive format to extract. Defaults to "tar.gz". */
	readonly archiveType?: "tar.gz" | "tar.xz" | "zip";

	/** Subdirectory within the extracted archive containing binaries. */
	readonly binSubPath?: string;

	/** Target platform (e.g. "linux", "darwin"). */
	readonly platform?: string;

	/** Target architecture (e.g. "x64", "arm64"). */
	readonly arch?: string;
}

/**
 * Service for downloading, extracting, caching, and adding tool binaries to PATH.
 *
 * Uses `@actions/tool-cache` as an optional peer dependency.
 *
 * @public
 */
export class ToolInstaller extends Context.Tag("github-action-effects/ToolInstaller")<
	ToolInstaller,
	{
		/** Download, extract, and cache a tool binary. Returns the cached tool path. */
		readonly install: (
			name: string,
			version: string,
			downloadUrl: string,
			options?: ToolInstallOptions,
		) => Effect.Effect<string, ToolInstallerError>;

		/** Check if a tool is already cached. */
		readonly isCached: (name: string, version: string) => Effect.Effect<boolean>;

		/** Install a tool and add it to the system PATH. Returns the cached tool path. */
		readonly installAndAddToPath: (
			name: string,
			version: string,
			downloadUrl: string,
			options?: ToolInstallOptions,
		) => Effect.Effect<string, ToolInstallerError>;

		/** Download, cache, and optionally chmod a single binary file. Returns the cached directory path. */
		readonly installBinary: (
			name: string,
			version: string,
			downloadUrl: string,
			options?: BinaryInstallOptions,
		) => Effect.Effect<string, ToolInstallerError>;

		/** Install a single binary and add it to the system PATH. Returns the cached directory path. */
		readonly installBinaryAndAddToPath: (
			name: string,
			version: string,
			downloadUrl: string,
			options?: BinaryInstallOptions,
		) => Effect.Effect<string, ToolInstallerError>;
	}
>() {}
