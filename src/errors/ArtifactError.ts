import { Data } from "effect";

/**
 * Error when an artifact operation (upload, download, list, get, delete) fails.
 *
 * @public
 */
export class ArtifactError extends Data.TaggedError("ArtifactError")<{
	/** The operation that failed. */
	readonly operation: "upload" | "download" | "list" | "get" | "delete";
	/** Artifact name or id (string for uniform formatting). */
	readonly artifact: string;
	/** Human-readable description of what went wrong. */
	readonly reason: string;
	/**
	 * True for 5xx / network failures — the caller may retry. Mirrors
	 * `GitHubClientError`'s `retryable` flag for consistency with the WS2 retry
	 * story.
	 */
	readonly retryable?: boolean;
}> {}
