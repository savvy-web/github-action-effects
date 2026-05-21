import { Data } from "effect";

/**
 * Error from GitHub repository-content operations.
 */
export class GitHubContentError extends Data.TaggedError("GitHubContentError")<{
	/** The operation that failed. */
	readonly operation: "getFile";

	/** The path requested, when known. */
	readonly path?: string;

	/** Human-readable description. */
	readonly reason: string;
}> {}
