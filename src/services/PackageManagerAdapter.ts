import type { Effect } from "effect";
import { Context } from "effect";
import type { PackageManagerError } from "../errors/PackageManagerError.js";
import type { PackageManagerInfo } from "../schemas/PackageManager.js";
import type { ExecOptions, ExecOutput } from "./CommandRunner.js";

/**
 * Options for package installation.
 *
 * @public
 */
export interface InstallOptions {
	/** Whether to use frozen/immutable lockfile. Defaults to true. */
	readonly frozen?: boolean;
	/** Working directory for installation. */
	readonly cwd?: string;
}

/**
 * Service interface for unified package manager operations.
 *
 * Supports npm, pnpm, yarn, bun, and deno with automatic detection.
 *
 * @public
 */
export interface PackageManagerAdapter {
	/** Detect the package manager used by the project. */
	readonly detect: () => Effect.Effect<PackageManagerInfo, PackageManagerError>;

	/** Install project dependencies using the detected package manager. */
	readonly install: (options?: InstallOptions) => Effect.Effect<void, PackageManagerError>;

	/** Get cache directory paths for the detected package manager. */
	readonly getCachePaths: () => Effect.Effect<Array<string>, PackageManagerError>;

	/** Get lockfile paths for the detected package manager. */
	readonly getLockfilePaths: () => Effect.Effect<Array<string>, PackageManagerError>;

	/** Execute a command via the detected package manager. */
	readonly exec: (args: Array<string>, options?: ExecOptions) => Effect.Effect<ExecOutput, PackageManagerError>;
}

/**
 * PackageManagerAdapter tag for dependency injection.
 *
 * @public
 */
export const PackageManagerAdapter = Context.GenericTag<PackageManagerAdapter>("PackageManagerAdapter");
