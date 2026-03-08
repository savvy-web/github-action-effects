import { Data } from "effect";

/**
 * Base class for GitTagError.
 *
 * @internal
 */
export const GitTagErrorBase = Data.TaggedError("GitTagError");

/**
 * Error from tag management operations.
 */
export class GitTagError extends GitTagErrorBase<{
	/** The operation that failed. */
	readonly operation: "create" | "delete" | "list" | "resolve";

	/** The tag name, if applicable. */
	readonly tag?: string;

	/** Human-readable description. */
	readonly reason: string;
}> {}
