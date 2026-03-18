import { Data } from "effect";

/**
 * Error from GitHub App authentication operations.
 */
export class GitHubAppError extends Data.TaggedError("GitHubAppError")<{
	/** The operation that failed. */
	readonly operation: "jwt" | "token" | "revoke";

	/** Human-readable description. */
	readonly reason: string;
}> {}
