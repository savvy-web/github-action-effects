import { Effect, Layer, Option } from "effect";
import { ActionCache } from "../services/ActionCache.js";

/**
 * In-memory cache state for testing.
 *
 * @public
 */
export interface ActionCacheTestState {
	readonly entries: Map<string, ReadonlyArray<string>>;
}

const makeTestCache = (state: ActionCacheTestState): typeof ActionCache.Service => ({
	save: (paths, key) =>
		Effect.sync(() => {
			state.entries.set(key, [...paths]);
		}),

	restore: (_paths, primaryKey, restoreKeys = []) =>
		Effect.sync((): Option.Option<string> => {
			// Check exact match first
			if (state.entries.has(primaryKey)) {
				return Option.some(primaryKey);
			}
			// Check restore keys (prefix match)
			for (const rk of restoreKeys) {
				for (const entryKey of state.entries.keys()) {
					if (entryKey.startsWith(rk)) {
						return Option.some(entryKey);
					}
				}
			}
			return Option.none();
		}),
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
