import { Data } from "effect";

/**
 * Base class for ToolInstallerError.
 *
 * @internal
 */
export const ToolInstallerErrorBase = Data.TaggedError("ToolInstallerError");

/**
 * Error from tool installation operations.
 */
export class ToolInstallerError extends ToolInstallerErrorBase<{
	/** The tool name. */
	readonly tool: string;

	/** The tool version. */
	readonly version: string;

	/** The operation that failed. */
	readonly operation: "download" | "extract" | "cache" | "path";

	/** Human-readable description. */
	readonly reason: string;
}> {}
