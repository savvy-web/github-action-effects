import { Data } from "effect";

/**
 * Error from GitHub Issue operations.
 */
export class GitHubIssueError extends Data.TaggedError("GitHubIssueError")<{
	/** The operation that failed. */
	readonly operation: "list" | "close" | "comment" | "getLinkedIssues";

	/** The issue number, if applicable. */
	readonly issueNumber?: number;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** Whether this error is retryable (e.g., rate limit, 5xx). */
	readonly retryable: boolean;
}> {}
