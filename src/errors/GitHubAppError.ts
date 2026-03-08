import { Data } from "effect";

/**
 * Base class for GitHubAppError.
 *
 * @internal
 */
export const GitHubAppErrorBase = Data.TaggedError("GitHubAppError");

/**
 * Error from GitHub App authentication operations.
 */
export class GitHubAppError extends GitHubAppErrorBase<{
	/** The operation that failed. */
	readonly operation: "jwt" | "token" | "revoke";

	/** Human-readable description. */
	readonly reason: string;
}> {}
