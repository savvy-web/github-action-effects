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
					}).pipe(Effect.map((response) => response.data)),

				graphql: <T>(query: string, variables: Record<string, unknown> = {}) =>
					Effect.tryPromise({
						try: () => octokit.graphql<T>(query, variables),
						catch: (error) => wrapError("graphql", error),
					}),

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
				}),
			})),
		),
	);
