import { Data } from "effect";

/**
 * Error from pull request operations.
 */
export class PullRequestError extends Data.TaggedError("PullRequestError")<{
	/** The operation that failed. */
	readonly operation:
		| "get"
		| "list"
		| "create"
		| "update"
		| "getOrCreate"
		| "merge"
		| "addLabels"
		| "requestReviewers"
		| "autoMerge";

	/** The PR number, when known. */
	readonly prNumber?: number;

	/** Human-readable description. */
	readonly reason: string;
}> {}
