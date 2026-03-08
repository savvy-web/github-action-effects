import type { Effect } from "effect";
import { Context } from "effect";
import type { ActionCacheError } from "../errors/ActionCacheError.js";

/**
 * Result of a cache restore operation.
 *
 * @public
 */
export interface CacheHit {
	/** Whether a cache entry was found. */
	readonly hit: boolean;
	/** The key that matched, if any. */
	readonly matchedKey: string | undefined;
}

/**
 * Service interface for GitHub Actions cache operations.
 *
 * @public
 */
export interface ActionCache {
	/** Save paths to cache under the given key. */
	readonly save: (key: string, paths: ReadonlyArray<string>) => Effect.Effect<void, ActionCacheError>;

	/** Restore from cache. Returns hit status and matched key. */
	readonly restore: (
		key: string,
		paths: ReadonlyArray<string>,
		restoreKeys?: ReadonlyArray<string>,
	) => Effect.Effect<CacheHit, ActionCacheError>;

	/**
	 * Bracket pattern: restore cache, run effect, save if cache miss.
	 * Returns the effect's result regardless of cache hit/miss.
	 */
	readonly withCache: <A, E>(
		key: string,
		paths: ReadonlyArray<string>,
		effect: Effect.Effect<A, E>,
		restoreKeys?: ReadonlyArray<string>,
	) => Effect.Effect<A, E | ActionCacheError>;
}

/**
 * ActionCache tag for dependency injection.
 *
 * @public
 */
export const ActionCache = Context.GenericTag<ActionCache>("ActionCache");
