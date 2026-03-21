import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { ActionCacheError } from "../errors/ActionCacheError.js";

/**
 * Service for GitHub Actions cache operations.
 *
 * Uses the internal GitHub Actions cache protocol directly via native `fetch`,
 * with no dependency on `@actions/cache`.
 *
 * @public
 */
export class ActionCache extends Context.Tag("github-action-effects/ActionCache")<
	ActionCache,
	{
		/** Save paths to cache under the given key. */
		readonly save: (paths: ReadonlyArray<string>, key: string) => Effect.Effect<void, ActionCacheError>;

		/**
		 * Restore from cache. Returns the matched key wrapped in Option,
		 * or Option.none() on cache miss.
		 */
		readonly restore: (
			paths: ReadonlyArray<string>,
			primaryKey: string,
			restoreKeys?: ReadonlyArray<string>,
		) => Effect.Effect<Option.Option<string>, ActionCacheError>;
	}
>() {}
