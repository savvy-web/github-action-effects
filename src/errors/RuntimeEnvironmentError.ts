import { Data } from "effect";

/**
 * Error when a required runtime environment variable (e.g. GITHUB_OUTPUT) is missing.
 */
export class RuntimeEnvironmentError extends Data.TaggedError("RuntimeEnvironmentError")<{
	/** The environment variable name. */
	readonly variable: string;

	/** Human-readable description of what went wrong. */
	readonly message: string;
}> {}
