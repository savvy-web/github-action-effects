import { Data } from "effect";

/**
 * Base class for GitCommitError.
 *
 * @internal
 */
export const GitCommitErrorBase = Data.TaggedError("GitCommitError");

/**
 * Error from git commit operations via Git Data API.
 */
export class GitCommitError extends GitCommitErrorBase<{
	/** The operation that failed. */
	readonly operation: "tree" | "commit" | "ref";

	/** Human-readable description. */
	readonly reason: string;
}> {}
