import { Data } from "effect";

/**
 * Error from tag management operations.
 */
export class GitTagError extends Data.TaggedError("GitTagError")<{
	/** The operation that failed. */
	readonly operation: "create" | "delete" | "list" | "resolve";

	/** The tag name, if applicable. */
	readonly tag?: string;

	/** Human-readable description. */
	readonly reason: string;
}> {}
