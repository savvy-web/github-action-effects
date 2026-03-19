import { Effect, Layer } from "effect";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { ActionsGitHub } from "../services/ActionsGitHub.js";
import { GitHubClient } from "../services/GitHubClient.js";

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

const wrapError = (operation: string, error: unknown): GitHubClientError => {
	const status =
		typeof error === "object" && error !== null && "status" in error ? (error as { status: number }).status : undefined;
	let message = error instanceof Error ? error.message : String(error);

	// Detect HTML error responses (GitHub "Unicorn" pages) and replace with clean message
	if (message.includes("<!DOCTYPE") || message.includes("<html")) {
		message =
			status !== undefined ? `GitHub API returned ${status} (server error)` : "GitHub API returned an HTML error page";
	}

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
export const GitHubClientLive = (token: string): Layer.Layer<GitHubClient, GitHubClientError, ActionsGitHub> =>
	Layer.effect(
		GitHubClient,
		Effect.flatMap(ActionsGitHub, (gh) =>
			Effect.try({
				try: () => gh.getOctokit(token),
				catch: (error) => wrapError("getOctokit", error),
			}),
		).pipe(
			Effect.map((octokit) => ({
				rest: <T>(operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
					Effect.tryPromise({
						try: () => fn(octokit),
						catch: (error) => wrapError(operation, error),
					}).pipe(Effect.map((response) => response.data)),

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

					return loop(1, []);
				},

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
