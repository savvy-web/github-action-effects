import { Data } from "effect";

/**
 * Base class for PullRequestCommentError.
 *
 * @internal
 */
export const PullRequestCommentErrorBase = Data.TaggedError("PullRequestCommentError");

/**
 * Error from PR comment operations.
 */
export class PullRequestCommentError extends PullRequestCommentErrorBase<{
	/** The PR number. */
	readonly prNumber: number;
	/** The operation that failed. */
	readonly operation: "create" | "upsert" | "find" | "delete";
	/** Human-readable description. */
	readonly reason: string;
}> {}
