import { Data } from "effect";

/**
 * Error from GitHub Packages artifact-metadata operations.
 */
export class GitHubArtifactMetadataError extends Data.TaggedError("GitHubArtifactMetadataError")<{
	/** The operation that failed. */
	readonly operation: "createStorageRecord";

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** Whether this error is retryable (e.g., rate limit, 5xx). */
	readonly retryable: boolean;
}> {}
