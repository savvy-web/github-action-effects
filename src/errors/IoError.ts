import { Data } from "effect";

/**
 * Error when a filesystem I/O lookup (`which` / `findInPath`) fails.
 *
 * @public
 */
export class IoError extends Data.TaggedError("IoError")<{
	/** The operation that failed. */
	readonly operation: "which" | "findInPath";
	/** The tool being looked up. */
	readonly tool: string;
	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
