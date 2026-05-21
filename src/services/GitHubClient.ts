import type { Effect, Stream } from "effect";
import { Context } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";

/**
 * Service for GitHub API operations via Octokit.
 *
 * @public
 */
export class GitHubClient extends Context.Tag("github-action-effects/GitHubClient")<
	GitHubClient,
	{
		/**
		 * Execute a REST API call via callback.
		 * The callback receives an Octokit instance and should return a response.
		 */
		readonly rest: <T>(
			operation: string,
			fn: (octokit: unknown) => Promise<{ data: T }>,
		) => Effect.Effect<T, GitHubClientError>;

		/**
		 * Execute a GraphQL query. Returns the response data.
		 */
		readonly graphql: <T>(query: string, variables?: Record<string, unknown>) => Effect.Effect<T, GitHubClientError>;

		/** Paginate a REST API call, collecting all results across pages. */
		readonly paginate: <T>(
			operation: string,
			fn: (octokit: unknown, page: number, perPage: number) => Promise<{ data: T[] }>,
			options?: { perPage?: number; maxPages?: number },
		) => Effect.Effect<Array<T>, GitHubClientError>;

		/**
		 * Paginate a REST API call as a Stream, one page's worth of items at a
		 * time. Lets consumers `Stream.takeWhile` / `Stream.take` and stop early
		 * without fetching or buffering the remaining pages. The eager `paginate`
		 * collects all pages; prefer `paginateStream` for large or
		 * early-terminating scans.
		 */
		readonly paginateStream: <T>(
			operation: string,
			fn: (octokit: unknown, page: number, perPage: number) => Promise<{ data: T[] }>,
			options?: { perPage?: number; maxPages?: number },
		) => Stream.Stream<T, GitHubClientError>;

		/**
		 * Get the repository context (owner and repo name).
		 * Derived from GITHUB_REPOSITORY environment variable.
		 */
		readonly repo: Effect.Effect<{ owner: string; repo: string }, GitHubClientError>;
	}
>() {}
