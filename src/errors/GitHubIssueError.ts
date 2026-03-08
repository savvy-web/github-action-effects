import { Data } from "effect";

/**
 * Base class for GitHubIssueError.
 *
 * @internal
 */
export const GitHubIssueErrorBase = Data.TaggedError("GitHubIssueError");

/**
 * Error from GitHub Issue operations.
 */
export class GitHubIssueError extends GitHubIssueErrorBase<{
	/** The operation that failed. */
	readonly operation: "list" | "close" | "comment" | "getLinkedIssues";

	/** The issue number, if applicable. */
	readonly issueNumber?: number;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** Whether this error is retryable (e.g., rate limit, 5xx). */
	readonly retryable: boolean;
}> {}
