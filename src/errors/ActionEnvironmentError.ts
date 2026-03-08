import { Data } from "effect";

/**
 * Base class for ActionEnvironmentError.
 *
 * @internal
 */
export const ActionEnvironmentErrorBase = Data.TaggedError("ActionEnvironmentError");

/**
 * Error when a required environment variable is missing or invalid.
 */
export class ActionEnvironmentError extends ActionEnvironmentErrorBase<{
	/** The environment variable name. */
	readonly variable: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
