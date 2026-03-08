import { Effect } from "effect";
import type { GitHubGraphQLError } from "../errors/GitHubGraphQLError.js";
import { GitHubGraphQL } from "../services/GitHubGraphQL.js";

const ENABLE_MUTATION = `
  mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod) {
    enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
      clientMutationId
    }
  }
`;

const DISABLE_MUTATION = `
  mutation DisableAutoMerge($pullRequestId: ID!) {
    disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
      clientMutationId
    }
  }
`;

/**
 * Namespace for PR auto-merge operations via GitHub GraphQL API.
 *
 * @public
 */
export const AutoMerge = {
	/**
	 * Enable auto-merge on a pull request.
	 */
	enable: (
		prNodeId: string,
		mergeMethod?: "MERGE" | "SQUASH" | "REBASE",
	): Effect.Effect<void, GitHubGraphQLError, GitHubGraphQL> =>
		GitHubGraphQL.pipe(
			Effect.flatMap((gql) =>
				gql.mutation("enableAutoMerge", ENABLE_MUTATION, {
					pullRequestId: prNodeId,
					mergeMethod: mergeMethod ?? "SQUASH",
				}),
			),
			Effect.asVoid,
			Effect.withSpan("AutoMerge.enable", { attributes: { "pr.nodeId": prNodeId } }),
		),

	/**
	 * Disable auto-merge on a pull request.
	 */
	disable: (prNodeId: string): Effect.Effect<void, GitHubGraphQLError, GitHubGraphQL> =>
		GitHubGraphQL.pipe(
			Effect.flatMap((gql) =>
				gql.mutation("disableAutoMerge", DISABLE_MUTATION, {
					pullRequestId: prNodeId,
				}),
			),
			Effect.asVoid,
			Effect.withSpan("AutoMerge.disable", { attributes: { "pr.nodeId": prNodeId } }),
		),
} as const;
