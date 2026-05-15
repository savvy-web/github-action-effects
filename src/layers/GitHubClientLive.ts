import { Octokit } from "@octokit/rest";
import { Effect, Layer, Redacted } from "effect";
import type { GitHubAppError } from "../errors/GitHubAppError.js";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubApp } from "../services/GitHubApp.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubAppLive } from "./GitHubAppLive.js";
import { OctokitAuthAppLive } from "./OctokitAuthAppLive.js";

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

/** Unwrap a token that may be plain or Redacted. */
const unwrapToken = (token: string | Redacted.Redacted<string>): string =>
	typeof token === "string" ? token : Redacted.value(token);

/** Build the GitHubClient service object from a concrete token. */
const makeClient = (token: string): typeof GitHubClient.Service => {
	const octokit = new Octokit({ auth: token });
	return {
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
	};
};

/**
 * Reads the ambient `process.env.GITHUB_TOKEN` — the weak repo-scoped default
 * token. NOT the path for permission-sensitive work; use `fromToken` or `fromApp`
 * with an explicitly constructed identity instead.
 */
const fromEnv: Layer.Layer<GitHubClient, GitHubClientError> = Layer.effect(
	GitHubClient,
	Effect.try({
		try: () => {
			const token = process.env.GITHUB_TOKEN;
			if (!token) throw new Error("GITHUB_TOKEN not set");
			return makeClient(token);
		},
		catch: (error) => wrapError("getOctokit", error),
	}),
);

/** Build a client from an explicit token. No `process.env` dependency. */
const fromToken = (token: string | Redacted.Redacted<string>): Layer.Layer<GitHubClient> =>
	Layer.sync(GitHubClient, () => makeClient(unwrapToken(token)));

/**
 * Generate a GitHub App installation token from App credentials, then build the
 * client. Composes `OctokitAuthAppLive` + `GitHubAppLive` internally.
 *
 * Generates a fresh installation token each time the layer is built. For the
 * pre/main/post pattern where one token is shared across phases, use the
 * `GitHubToken` namespace instead.
 */
const fromApp = (options: {
	clientId: string;
	privateKey: string | Redacted.Redacted<string>;
	installationId?: number;
}): Layer.Layer<GitHubClient, GitHubAppError> =>
	Layer.effect(
		GitHubClient,
		Effect.gen(function* () {
			const app = yield* GitHubApp;
			const installationToken = yield* app.generateToken(
				options.clientId,
				unwrapToken(options.privateKey),
				options.installationId,
			);
			return makeClient(installationToken.token);
		}),
	).pipe(Layer.provide(GitHubAppLive), Layer.provide(OctokitAuthAppLive));

/**
 * Live `GitHubClient` layer constructors.
 *
 * @public
 */
export const GitHubClientLive = {
	fromEnv,
	fromToken,
	fromApp,
} as const;
