import { Data } from "effect";

/**
 * Base class for ActionOutputError.
 *
 * @internal
 */
export const ActionOutputErrorBase = Data.TaggedError("ActionOutputError");

/**
 * Error when a GitHub Action output fails schema validation or writing.
 */
export class ActionOutputError extends ActionOutputErrorBase<{
	/** The output name. */
	readonly outputName: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
