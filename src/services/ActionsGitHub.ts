import { Context } from "effect";

/**
 * The Octokit instance type returned by `@actions/github.getOctokit()`.
 *
 * @public
 */
export interface GitHubOctokit {
	readonly graphql: <T>(query: string, parameters?: Record<string, unknown>) => Promise<T>;
	// Typed as unknown to avoid importing Octokit's deep type hierarchy;
	// consumers pass the octokit instance to callback fns that cast internally.
	readonly rest: unknown;
	readonly request: unknown;
}

/**
 * Wrapper service for `@actions/github`.
 *
 * @public
 */
export class ActionsGitHub extends Context.Tag("github-action-effects/ActionsGitHub")<
	ActionsGitHub,
	{
		readonly getOctokit: (token: string) => GitHubOctokit;
	}
>() {}
