import { Data } from "effect";

/**
 * Base class for PullRequestError.
 *
 * @internal
 */
export const PullRequestErrorBase = Data.TaggedError("PullRequestError");

/**
 * Error from pull request operations.
 */
export class PullRequestError extends PullRequestErrorBase<{
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
