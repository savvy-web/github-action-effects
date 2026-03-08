import { Data } from "effect";

/**
 * Base class for ChangesetError.
 *
 * @internal
 */
export const ChangesetErrorBase = Data.TaggedError("ChangesetError");

/**
 * Error from changeset operations.
 */
export class ChangesetError extends ChangesetErrorBase<{
	/** The operation that failed. */
	readonly operation: "parse" | "generate" | "read";

	/** Human-readable description. */
	readonly reason: string;
}> {}
