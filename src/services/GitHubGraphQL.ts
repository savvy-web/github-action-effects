import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubGraphQLError } from "../errors/GitHubGraphQLError.js";

/**
 * Service interface for GitHub GraphQL API operations.
 *
 * @public
 */
export interface GitHubGraphQL {
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

/**
 * GitHubGraphQL tag for dependency injection.
 *
 * @public
 */
export const GitHubGraphQL = Context.GenericTag<GitHubGraphQL>("GitHubGraphQL");
