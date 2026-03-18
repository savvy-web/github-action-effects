import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubGraphQLError } from "../errors/GitHubGraphQLError.js";

/**
 * Service for GitHub GraphQL API operations.
 *
 * @public
 */
export class GitHubGraphQL extends Context.Tag("github-action-effects/GitHubGraphQL")<
	GitHubGraphQL,
	{
		readonly query: <T>(
			operation: string,
			queryString: string,
			variables?: Record<string, unknown>,
		) => Effect.Effect<T, GitHubGraphQLError>;

		readonly mutation: <T>(
			operation: string,
			mutationString: string,
			variables?: Record<string, unknown>,
		) => Effect.Effect<T, GitHubGraphQLError>;
	}
>() {}
