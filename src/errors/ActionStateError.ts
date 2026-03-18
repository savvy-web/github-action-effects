import { Data } from "effect";

/**
 * Error when GitHub Action state reading/writing fails.
 */
export class ActionStateError extends Data.TaggedError("ActionStateError")<{
	/** The state key name. */
	readonly key: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/** The raw string value received, if any. */
	readonly rawValue: string | undefined;
}> {}
