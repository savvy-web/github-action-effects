import { Data } from "effect";

/**
 * Error when a required environment variable is missing or invalid.
 */
export class ActionEnvironmentError extends Data.TaggedError("ActionEnvironmentError")<{
	/** The environment variable name. */
	readonly variable: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
