import { Data } from "effect";

/**
 * Error from tool installation operations.
 *
 * @public
 */
export class ToolInstallerError extends Data.TaggedError("ToolInstallerError")<{
	/** The tool name. */
	readonly tool: string;

	/** The tool version. */
	readonly version: string;

	/** The operation that failed. */
	readonly operation: "download" | "extract" | "cache" | "path" | "chmod";

	/** Human-readable description. */
	readonly reason: string;
}> {}
