import { Data } from "effect";

/**
 * Error from changeset operations.
 */
export class ChangesetError extends Data.TaggedError("ChangesetError")<{
	/** The operation that failed. */
	readonly operation: "parse" | "generate" | "read";

	/** Human-readable description. */
	readonly reason: string;
}> {}
