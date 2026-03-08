import * as cache from "@actions/cache";
import { Effect, Layer } from "effect";
import { ActionCacheError } from "../errors/ActionCacheError.js";
import type { CacheHit } from "../services/ActionCache.js";
import { ActionCache } from "../services/ActionCache.js";

export const ActionCacheLive: Layer.Layer<ActionCache> = Layer.succeed(ActionCache, {
	save: (key, paths) =>
		Effect.tryPromise({
			try: () => cache.saveCache([...paths], key),
			catch: (error) =>
				new ActionCacheError({
					key,
					operation: "save",
					reason: `Cache save failed: ${error instanceof Error ? error.message : String(error)}`,
				}),
		}).pipe(Effect.asVoid, Effect.withSpan("ActionCache.save", { attributes: { "cache.key": key } })),

	restore: (key, paths, restoreKeys = []) =>
		Effect.tryPromise({
			try: () => cache.restoreCache([...paths], key, [...restoreKeys]),
			catch: (error) =>
				new ActionCacheError({
					key,
					operation: "restore",
					reason: `Cache restore failed: ${error instanceof Error ? error.message : String(error)}`,
				}),
		}).pipe(
			Effect.map(
				(matchedKey): CacheHit => ({
					hit: matchedKey !== undefined,
					matchedKey: matchedKey ?? undefined,
				}),
			),
			Effect.withSpan("ActionCache.restore", { attributes: { "cache.key": key } }),
		),

	withCache: (key, paths, effect, restoreKeys = []) =>
		Effect.tryPromise({
			try: () => cache.restoreCache([...paths], key, [...restoreKeys]),
			catch: (error) =>
				new ActionCacheError({
					key,
					operation: "restore",
					reason: `Cache restore failed: ${error instanceof Error ? error.message : String(error)}`,
				}),
		}).pipe(
			Effect.flatMap((matchedKey) =>
				Effect.flatMap(effect, (result) => {
					if (matchedKey === key) {
						// Exact hit — no need to re-save
						return Effect.succeed(result);
					}
					// Cache miss or partial hit — save after effect completes
					return Effect.tryPromise({
						try: () => cache.saveCache([...paths], key),
						catch: (error) =>
							new ActionCacheError({
								key,
								operation: "save",
								reason: `Cache save failed: ${error instanceof Error ? error.message : String(error)}`,
							}),
					}).pipe(Effect.map(() => result));
				}),
			),
			Effect.withSpan("ActionCache.withCache", { attributes: { "cache.key": key } }),
		),
});
