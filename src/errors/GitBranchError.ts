import { Data } from "effect";

/**
 * Error from branch management operations.
 */
export class GitBranchError extends Data.TaggedError("GitBranchError")<{
	/** The branch name. */
	readonly branch: string;

	/** The operation that failed. */
	readonly operation: "create" | "delete" | "get" | "reset";

	/** Human-readable description. */
	readonly reason: string;
}> {}
