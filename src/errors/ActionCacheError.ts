import { Data } from "effect";

/**
 * Error when a cache operation (save or restore) fails.
 */
export class ActionCacheError extends Data.TaggedError("ActionCacheError")<{
	/** The cache key involved. */
	readonly key: string;
	/** The operation that failed. */
	readonly operation: "save" | "restore";
	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
