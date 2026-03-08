import { Data } from "effect";

/**
 * Base class for GitHubGraphQLError.
 *
 * @internal
 */
export const GitHubGraphQLErrorBase = Data.TaggedError("GitHubGraphQLError");

/**
 * Error from GitHub GraphQL operations.
 */
export class GitHubGraphQLError extends GitHubGraphQLErrorBase<{
	readonly operation: string;
	readonly reason: string;
	readonly errors: ReadonlyArray<{
		readonly message: string;
		readonly type?: string;
	}>;
}> {}
