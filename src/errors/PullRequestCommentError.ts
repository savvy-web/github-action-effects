import { Data } from "effect";

/**
 * Error from PR comment operations.
 */
export class PullRequestCommentError extends Data.TaggedError("PullRequestCommentError")<{
	/** The PR number. */
	readonly prNumber: number;
	/** The operation that failed. */
	readonly operation: "create" | "upsert" | "find" | "delete";
	/** Human-readable description. */
	readonly reason: string;
}> {}
