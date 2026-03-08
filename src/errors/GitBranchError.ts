import { Data } from "effect";

/**
 * Base class for GitBranchError.
 *
 * @internal
 */
export const GitBranchErrorBase = Data.TaggedError("GitBranchError");

/**
 * Error from branch management operations.
 */
export class GitBranchError extends GitBranchErrorBase<{
	/** The branch name. */
	readonly branch: string;

	/** The operation that failed. */
	readonly operation: "create" | "delete" | "get" | "reset";

	/** Human-readable description. */
	readonly reason: string;
}> {}
