import { Data } from "effect";

/**
 * Base class for ActionInputError.
 *
 * @internal
 */
export const ActionInputErrorBase = Data.TaggedError("ActionInputError");

/**
 * Error when a GitHub Action input is missing or fails schema validation.
 */
export class ActionInputError extends ActionInputErrorBase<{
	/** The input name from action.yml. */
	readonly inputName: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** The raw string value received, if any. */
	readonly rawValue: string | undefined;
}> {}
