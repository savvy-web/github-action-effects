import * as cache from "@actions/cache";
import { Layer } from "effect";
import { ActionsCache } from "../services/ActionsCache.js";

/**
 * Live implementation of {@link ActionsCache} using `@actions/cache`.
 *
 * @public
 */
export const ActionsCacheLive: Layer.Layer<ActionsCache> = Layer.succeed(ActionsCache, {
	saveCache: (paths, key) => cache.saveCache(paths, key),
	restoreCache: (paths, primaryKey, restoreKeys) => cache.restoreCache(paths, primaryKey, restoreKeys),
});
