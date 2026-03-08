import * as github from "@actions/github";
import { Effect, Layer } from "effect";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubClient } from "../services/GitHubClient.js";

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

const wrapError = (operation: string, error: unknown): GitHubClientError => {
	const status =
		typeof error === "object" && error !== null && "status" in error ? (error as { status: number }).status : undefined;
	const message = error instanceof Error ? error.message : String(error);
	return new GitHubClientError({
		operation,
		status,
		reason: message,
		retryable: status !== undefined && isRetryableStatus(status),
	});
};

/**
 * Create a live GitHubClient layer with a token.
 *
 * @public
 */
export const GitHubClientLive = (token: string): Layer.Layer<GitHubClient, GitHubClientError> =>
	Layer.effect(
		GitHubClient,
		Effect.try({
			try: () => github.getOctokit(token),
			catch: (error) => wrapError("getOctokit", error),
		}).pipe(
			Effect.map((octokit) => ({
				rest: <T>(operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
					Effect.tryPromise({
						try: () => fn(octokit),
						catch: (error) => wrapError(operation, error),
					}).pipe(
						Effect.map((response) => response.data),
						Effect.withSpan("GitHubClient.rest", { attributes: { "github.operation": operation } }),
					),

				paginate: <T>(
					operation: string,
					fn: (octokit: unknown, page: number, perPage: number) => Promise<{ data: T[] }>,
					options?: { perPage?: number; maxPages?: number },
				) => {
					const perPage = options?.perPage ?? 100;
					const maxPages = options?.maxPages ?? Infinity;

					const loop = (page: number, accumulated: Array<T>): Effect.Effect<Array<T>, GitHubClientError> =>
						Effect.tryPromise({
							try: () => fn(octokit, page, perPage),
							catch: (error) => wrapError(operation, error),
						}).pipe(
							Effect.flatMap((response) => {
								const results = [...accumulated, ...response.data];
								if (response.data.length < perPage || page >= maxPages) {
									return Effect.succeed(results);
								}
								return loop(page + 1, results);
							}),
						);

					return loop(1, []).pipe(
						Effect.withSpan("GitHubClient.paginate", {
							attributes: {
								"github.operation": operation,
								"pagination.perPage": perPage,
							},
						}),
					);
				},

				graphql: <T>(query: string, variables: Record<string, unknown> = {}) =>
					Effect.tryPromise({
						try: () => octokit.graphql<T>(query, variables),
						catch: (error) => wrapError("graphql", error),
					}).pipe(Effect.withSpan("GitHubClient.graphql", { attributes: { "github.operation": "graphql" } })),

				repo: Effect.try({
					try: () => {
						const repository = process.env.GITHUB_REPOSITORY;
						if (!repository) {
							throw new Error("GITHUB_REPOSITORY not set");
						}
						const parts = repository.split("/");
						const owner = parts[0] ?? "";
						const repo = parts[1] ?? "";
						return { owner, repo };
					},
					catch: (error) =>
						new GitHubClientError({
							operation: "repo",
							status: undefined,
							reason: error instanceof Error ? error.message : String(error),
							retryable: false,
						}),
				}).pipe(Effect.withSpan("GitHubClient.repo")),
			})),
		),
	);
