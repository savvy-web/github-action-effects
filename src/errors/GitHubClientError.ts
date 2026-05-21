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

	/**
	 * Server-advised delay before retrying, in milliseconds, if the response
	 * carried a `Retry-After` header or an exhausted `x-ratelimit-reset`.
	 * `undefined` when the server gave no explicit hint (the resilient client
	 * then falls back to its exponential backoff).
	 */
	readonly retryAfterMs: number | undefined;
}> {}
