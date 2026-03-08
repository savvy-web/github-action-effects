import { Data } from "effect";

/**
 * Base class for GitHubClientError.
 *
 * @internal
 */
export const GitHubClientErrorBase = Data.TaggedError("GitHubClientError");

/**
 * Error from GitHub API operations.
 */
export class GitHubClientError extends GitHubClientErrorBase<{
	/** The operation that failed (e.g., "rest.repos.get", "graphql"). */
	readonly operation: string;

	/** HTTP status code, if available. */
	readonly status: number | undefined;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** Whether this error is retryable (e.g., rate limit, 5xx). */
	readonly retryable: boolean;
}> {}
