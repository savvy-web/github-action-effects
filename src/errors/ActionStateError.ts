import { Data } from "effect";

/**
 * Base class for ActionStateError.
 *
 * @internal
 */
export const ActionStateErrorBase = Data.TaggedError("ActionStateError");

/**
 * Error when GitHub Action state reading/writing fails.
 */
export class ActionStateError extends ActionStateErrorBase<{
	/** The state key name. */
	readonly key: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** The raw string value received, if any. */
	readonly rawValue: string | undefined;
}> {}
