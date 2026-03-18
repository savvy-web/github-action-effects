import { Data } from "effect";

/**
 * Error from GitHub API operations.
 */
export class GitHubClientError extends Data.TaggedError("GitHubClientError")<{
	/** The operation that failed (e.g., "rest.repos.get", "graphql"). */
	readonly operation: string;

	/** HTTP status code, if available. */
	readonly status: number | undefined;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** Whether this error is retryable (e.g., rate limit, 5xx). */
	readonly retryable: boolean;
}> {}
