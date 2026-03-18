import { Data } from "effect";

/**
 * Error from git commit operations via Git Data API.
 */
export class GitCommitError extends Data.TaggedError("GitCommitError")<{
	/** The operation that failed. */
	readonly operation: "tree" | "commit" | "ref";

	/** Human-readable description. */
	readonly reason: string;
}> {}
