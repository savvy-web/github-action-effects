import { Data } from "effect";

/**
 * Error from check run operations.
 */
export class CheckRunError extends Data.TaggedError("CheckRunError")<{
	/** The check run name. */
	readonly name: string;

	/** The operation that failed. */
	readonly operation: "create" | "update" | "complete";

	/** Human-readable description. */
	readonly reason: string;
}> {}
