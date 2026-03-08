import { Effect, Layer } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubGraphQLError } from "../errors/GitHubGraphQLError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubGraphQL } from "../services/GitHubGraphQL.js";

const extractGraphQLErrors = (error: GitHubClientError): Array<{ message: string; type?: string }> => {
	try {
		const parsed = JSON.parse(error.reason);
		if (Array.isArray(parsed?.errors)) {
			return parsed.errors.map((e: { message?: string; type?: string }) => ({
				message: e.message ?? "Unknown error",
				type: e.type,
			}));
		}
	} catch {
		// Not JSON — single error message
	}
	return [{ message: error.reason }];
};

/**
 * Live implementation of GitHubGraphQL using GitHubClient.
 *
 * @public
 */
export const GitHubGraphQLLive: Layer.Layer<GitHubGraphQL, never, GitHubClient> = Layer.effect(
	GitHubGraphQL,
	Effect.map(GitHubClient, (client) => ({
		query: <T>(operation: string, queryString: string, variables?: Record<string, unknown>) =>
			client.graphql<T>(queryString, variables).pipe(
				Effect.mapError(
					(error) =>
						new GitHubGraphQLError({
							operation,
							reason: error.reason,
							errors: extractGraphQLErrors(error),
						}),
				),
				Effect.withSpan("GitHubGraphQL.query", {
					attributes: { "graphql.operation": operation },
				}),
			),

		mutation: <T>(operation: string, mutationString: string, variables?: Record<string, unknown>) =>
			client.graphql<T>(mutationString, variables).pipe(
				Effect.mapError(
					(error) =>
						new GitHubGraphQLError({
							operation,
							reason: error.reason,
							errors: extractGraphQLErrors(error),
						}),
				),
				Effect.withSpan("GitHubGraphQL.mutation", {
					attributes: { "graphql.operation": operation },
				}),
			),
	})),
);
