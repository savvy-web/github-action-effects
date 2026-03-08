import { Data } from "effect";

/**
 * Base class for ActionCacheError.
 *
 * @internal
 */
export const ActionCacheErrorBase = Data.TaggedError("ActionCacheError");

/**
 * Error when a cache operation (save or restore) fails.
 */
export class ActionCacheError extends ActionCacheErrorBase<{
	/** The cache key involved. */
	readonly key: string;
	/** The operation that failed. */
	readonly operation: "save" | "restore";
	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
