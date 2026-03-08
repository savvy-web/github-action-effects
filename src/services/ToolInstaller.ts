import type { Effect } from "effect";
import { Context } from "effect";
import type { ToolInstallerError } from "../errors/ToolInstallerError.js";

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
 * Service interface for downloading, extracting, caching, and adding tool binaries to PATH.
 *
 * Uses `@actions/tool-cache` as an optional peer dependency.
 *
 * @public
 */
export interface ToolInstaller {
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
}

/**
 * ToolInstaller tag for dependency injection.
 *
 * @public
 */
export const ToolInstaller = Context.GenericTag<ToolInstaller>("ToolInstaller");
