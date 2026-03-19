import { Context } from "effect";

/**
 * Wrapper service for `@actions/tool-cache`.
 *
 * @public
 */
export class ActionsToolCache extends Context.Tag("github-action-effects/ActionsToolCache")<
	ActionsToolCache,
	{
		readonly find: (toolName: string, versionSpec: string) => string;
		readonly downloadTool: (url: string) => Promise<string>;
		readonly extractTar: (file: string, dest?: string, flags?: string) => Promise<string>;
		readonly extractZip: (file: string, dest?: string) => Promise<string>;
		readonly cacheDir: (sourceDir: string, tool: string, version: string) => Promise<string>;
	}
>() {}
