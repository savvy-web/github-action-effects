import { Data } from "effect";

/**
 * Base class for CheckRunError.
 *
 * @internal
 */
export const CheckRunErrorBase = Data.TaggedError("CheckRunError");

/**
 * Error from check run operations.
 */
export class CheckRunError extends CheckRunErrorBase<{
	/** The check run name. */
	readonly name: string;

	/** The operation that failed. */
	readonly operation: "create" | "update" | "complete";

	/** Human-readable description. */
	readonly reason: string;
}> {}
