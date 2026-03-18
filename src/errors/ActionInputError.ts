import { Data } from "effect";

/**
 * Error when a GitHub Action input is missing or fails schema validation.
 */
export class ActionInputError extends Data.TaggedError("ActionInputError")<{
	/** The input name from action.yml. */
	readonly inputName: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** The raw string value received, if any. */
	readonly rawValue: string | undefined;
}> {}
