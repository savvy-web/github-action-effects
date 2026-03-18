import { Data } from "effect";

/**
 * Error from GitHub Release operations.
 */
export class GitHubReleaseError extends Data.TaggedError("GitHubReleaseError")<{
	/** The operation that failed. */
	readonly operation: "create" | "uploadAsset" | "getByTag" | "list";

	/** The release tag, if applicable. */
	readonly tag?: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** Whether this error is retryable (e.g., rate limit, 5xx). */
	readonly retryable: boolean;
}> {}
