import { Context } from "effect";

/**
 * Wrapper service for `@actions/cache`.
 *
 * @public
 */
export class ActionsCache extends Context.Tag("github-action-effects/ActionsCache")<
	ActionsCache,
	{
		readonly saveCache: (paths: string[], key: string) => Promise<number>;
		readonly restoreCache: (paths: string[], primaryKey: string, restoreKeys?: string[]) => Promise<string | undefined>;
	}
>() {}
