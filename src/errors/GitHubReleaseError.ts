import { Data } from "effect";

/**
 * Base class for GitHubReleaseError.
 *
 * @internal
 */
export const GitHubReleaseErrorBase = Data.TaggedError("GitHubReleaseError");

/**
 * Error from GitHub Release operations.
 */
export class GitHubReleaseError extends GitHubReleaseErrorBase<{
	/** The operation that failed. */
	readonly operation: "create" | "uploadAsset" | "getByTag" | "list";

	/** The release tag, if applicable. */
	readonly tag?: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** Whether this error is retryable (e.g., rate limit, 5xx). */
	readonly retryable: boolean;
}> {}
