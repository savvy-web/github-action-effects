import { Effect, Layer } from "effect";
import type { CacheHit } from "../services/ActionCache.js";
import { ActionCache } from "../services/ActionCache.js";

/**
 * In-memory cache state for testing.
 *
 * @public
 */
export interface ActionCacheTestState {
	readonly entries: Map<string, ReadonlyArray<string>>;
}

const makeTestCache = (state: ActionCacheTestState): ActionCache => ({
	save: (key, paths) =>
		Effect.sync(() => {
			state.entries.set(key, [...paths]);
		}),

	restore: (key, _paths, restoreKeys = []) =>
		Effect.sync((): CacheHit => {
			// Check exact match first
			if (state.entries.has(key)) {
				return { hit: true, matchedKey: key };
			}
			// Check restore keys (prefix match)
			for (const rk of restoreKeys) {
				for (const entryKey of state.entries.keys()) {
					if (entryKey.startsWith(rk)) {
						return { hit: true, matchedKey: entryKey };
					}
				}
			}
			return { hit: false, matchedKey: undefined };
		}),

	withCache: (key, paths, effect, _restoreKeys = []) => {
		const hasExactHit = state.entries.has(key);
		return Effect.flatMap(effect, (result) => {
			if (hasExactHit) {
				return Effect.succeed(result);
			}
			return Effect.sync(() => {
				state.entries.set(key, [...paths]);
				return result;
			});
		});
	},
});

/**
 * Test implementation for ActionCache.
 *
 * @example
 * ```ts
 * const state = ActionCacheTest.empty();
 * const layer = ActionCacheTest.layer(state);
 * ```
 *
 * @public
 */
export const ActionCacheTest = {
	/**
	 * Create a fresh empty test state container.
	 */
	empty: (): ActionCacheTestState => ({
		entries: new Map(),
	}),

	/**
	 * Create a test layer from the given state.
	 */
	layer: (state: ActionCacheTestState): Layer.Layer<ActionCache> => Layer.succeed(ActionCache, makeTestCache(state)),
} as const;
