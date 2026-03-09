import { Effect, Layer } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import type { GitHubGraphQLError } from "../errors/GitHubGraphQLError.js";
import { PullRequestError } from "../errors/PullRequestError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubGraphQL } from "../services/GitHubGraphQL.js";
import type { PullRequestInfo } from "../services/PullRequest.js";
import { PullRequest } from "../services/PullRequest.js";
import { DISABLE_MUTATION, ENABLE_MUTATION, MERGE_METHOD_MAP } from "../utils/AutoMerge.js";

interface RawPull {
	readonly number: number;
	readonly html_url: string;
	readonly node_id: string;
	readonly title: string;
	readonly state: string;
	readonly head: { readonly ref: string };
	readonly base: { readonly ref: string };
	readonly draft: boolean;
	readonly merged: boolean;
}

/** Minimal Octokit shape for pulls API calls. */
interface OctokitPulls {
	readonly rest: {
		readonly pulls: {
			readonly get: (args: Record<string, unknown>) => Promise<{ data: RawPull }>;
			readonly list: (args: Record<string, unknown>) => Promise<{ data: RawPull[] }>;
			readonly create: (args: Record<string, unknown>) => Promise<{ data: RawPull }>;
			readonly update: (args: Record<string, unknown>) => Promise<{ data: RawPull }>;
			readonly merge: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
			readonly requestReviewers: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
		};
		readonly issues: {
			readonly addLabels: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
		};
	};
}

const asPulls = (octokit: unknown): OctokitPulls => octokit as OctokitPulls;

const toInfo = (raw: RawPull): PullRequestInfo => ({
	number: raw.number,
	url: raw.html_url,
	nodeId: raw.node_id,
	title: raw.title,
	state: raw.state as "open" | "closed",
	head: raw.head.ref,
	base: raw.base.ref,
	draft: raw.draft,
	merged: raw.merged,
});

const mapClientError =
	(operation: PullRequestError["operation"], prNumber?: number) =>
	(error: GitHubClientError): PullRequestError =>
		new PullRequestError({
			operation,
			...(prNumber !== undefined ? { prNumber } : {}),
			reason: error.reason,
		});

const mapGraphQLError =
	(prNumber: number) =>
	(error: GitHubGraphQLError): PullRequestError =>
		new PullRequestError({
			operation: "autoMerge",
			prNumber,
			reason: error.reason,
		});

export const PullRequestLive: Layer.Layer<PullRequest, never, GitHubClient | GitHubGraphQL> = Layer.effect(
	PullRequest,
	Effect.all([GitHubClient, GitHubGraphQL]).pipe(
		Effect.map(([client, graphql]) => {
			const normalizeHead = (owner: string, head: string): string => (head.includes(":") ? head : `${owner}:${head}`);

			const handleAutoMerge = (
				nodeId: string,
				prNumber: number,
				autoMerge: "merge" | "squash" | "rebase" | false | undefined,
			): Effect.Effect<void, PullRequestError> => {
				if (autoMerge === undefined) return Effect.void;
				if (autoMerge === false) {
					return graphql
						.mutation("disableAutoMerge", DISABLE_MUTATION, { pullRequestId: nodeId })
						.pipe(Effect.asVoid, Effect.mapError(mapGraphQLError(prNumber)));
				}
				return graphql
					.mutation("enableAutoMerge", ENABLE_MUTATION, {
						pullRequestId: nodeId,
						mergeMethod: MERGE_METHOD_MAP[autoMerge],
					})
					.pipe(Effect.asVoid, Effect.mapError(mapGraphQLError(prNumber)));
			};

			return {
				get: (number) =>
					Effect.flatMap(client.repo, ({ owner, repo }) =>
						client.rest("pulls.get", (octokit) =>
							asPulls(octokit).rest.pulls.get({ owner, repo, pull_number: number }),
						),
					).pipe(
						Effect.map((data) => toInfo(data as unknown as RawPull)),
						Effect.mapError(mapClientError("get", number)),
						Effect.withSpan("PullRequest.get", { attributes: { "pr.number": String(number) } }),
					),

				list: (options) =>
					Effect.flatMap(client.repo, ({ owner, repo }) => {
						const args = {
							owner,
							repo,
							state: options?.state ?? "open",
							...(options?.head ? { head: normalizeHead(owner, options.head) } : {}),
							...(options?.base ? { base: options.base } : {}),
							...(options?.perPage ? { per_page: options.perPage } : {}),
						};

						if (options?.paginate) {
							return client.paginate(
								"pulls.list",
								(octokit, page, perPage) => asPulls(octokit).rest.pulls.list({ ...args, page, per_page: perPage }),
								{},
							);
						}
						return client
							.rest("pulls.list", (octokit) => asPulls(octokit).rest.pulls.list(args))
							.pipe(Effect.map((data) => data as unknown as RawPull[]));
					}).pipe(
						Effect.map((items) => (items as unknown as RawPull[]).map(toInfo)),
						Effect.mapError(mapClientError("list")),
						Effect.withSpan("PullRequest.list"),
					),

				create: (options) =>
					Effect.flatMap(client.repo, ({ owner, repo }) =>
						client.rest("pulls.create", (octokit) =>
							asPulls(octokit).rest.pulls.create({
								owner,
								repo,
								title: options.title,
								body: options.body,
								head: options.head,
								base: options.base,
								...(options.draft ? { draft: options.draft } : {}),
							}),
						),
					).pipe(
						Effect.map((data) => toInfo(data as unknown as RawPull)),
						Effect.mapError(mapClientError("create")),
						Effect.tap((info) => handleAutoMerge(info.nodeId, info.number, options.autoMerge)),
						Effect.withSpan("PullRequest.create", {
							attributes: { "pr.head": options.head, "pr.base": options.base },
						}),
					),

				update: (number, options) =>
					Effect.flatMap(client.repo, ({ owner, repo }) =>
						client.rest("pulls.update", (octokit) =>
							asPulls(octokit).rest.pulls.update({
								owner,
								repo,
								pull_number: number,
								...(options.title !== undefined ? { title: options.title } : {}),
								...(options.body !== undefined ? { body: options.body } : {}),
								...(options.state !== undefined ? { state: options.state } : {}),
							}),
						),
					).pipe(
						Effect.map((data) => toInfo(data as unknown as RawPull)),
						Effect.mapError(mapClientError("update", number)),
						Effect.tap((info) => handleAutoMerge(info.nodeId, info.number, options.autoMerge)),
						Effect.withSpan("PullRequest.update", { attributes: { "pr.number": String(number) } }),
					),

				getOrCreate: (options) =>
					Effect.flatMap(client.repo, ({ owner, repo }) =>
						client
							.rest("pulls.list", (octokit) =>
								asPulls(octokit).rest.pulls.list({
									owner,
									repo,
									head: normalizeHead(owner, options.head),
									base: options.base,
									state: "open",
									per_page: 1,
								}),
							)
							.pipe(
								Effect.map((data) => data as unknown as RawPull[]),
								Effect.flatMap(
									(existing): Effect.Effect<PullRequestInfo & { readonly created: boolean }, GitHubClientError> => {
										if (existing.length > 0) {
											return client
												.rest("pulls.update", (octokit) =>
													asPulls(octokit).rest.pulls.update({
														owner,
														repo,
														pull_number: existing[0].number,
														title: options.title,
														body: options.body,
													}),
												)
												.pipe(
													Effect.map((data) => ({
														...toInfo(data as unknown as RawPull),
														created: false as const,
													})),
												);
										}
										return client
											.rest("pulls.create", (octokit) =>
												asPulls(octokit).rest.pulls.create({
													owner,
													repo,
													title: options.title,
													body: options.body,
													head: options.head,
													base: options.base,
													...(options.draft ? { draft: options.draft } : {}),
												}),
											)
											.pipe(
												Effect.map((data) => ({
													...toInfo(data as unknown as RawPull),
													created: true as const,
												})),
											);
									},
								),
							),
					).pipe(
						Effect.mapError(mapClientError("getOrCreate")),
						Effect.tap((info) => handleAutoMerge(info.nodeId, info.number, options.autoMerge)),
						Effect.withSpan("PullRequest.getOrCreate", {
							attributes: { "pr.head": options.head, "pr.base": options.base },
						}),
					),

				merge: (number, options) =>
					Effect.flatMap(client.repo, ({ owner, repo }) =>
						client.rest("pulls.merge", (octokit) =>
							asPulls(octokit).rest.pulls.merge({
								owner,
								repo,
								pull_number: number,
								...(options?.method ? { merge_method: options.method } : {}),
								...(options?.commitTitle ? { commit_title: options.commitTitle } : {}),
								...(options?.commitMessage ? { commit_message: options.commitMessage } : {}),
							}),
						),
					).pipe(
						Effect.asVoid,
						Effect.mapError(mapClientError("merge", number)),
						Effect.withSpan("PullRequest.merge", { attributes: { "pr.number": String(number) } }),
					),

				addLabels: (number, labels) =>
					Effect.flatMap(client.repo, ({ owner, repo }) =>
						client.rest("issues.addLabels", (octokit) =>
							asPulls(octokit).rest.issues.addLabels({
								owner,
								repo,
								issue_number: number,
								labels: [...labels],
							}),
						),
					).pipe(
						Effect.asVoid,
						Effect.mapError(mapClientError("addLabels", number)),
						Effect.withSpan("PullRequest.addLabels", {
							attributes: { "pr.number": String(number) },
						}),
					),

				requestReviewers: (number, options) =>
					Effect.flatMap(client.repo, ({ owner, repo }) =>
						client.rest("pulls.requestReviewers", (octokit) =>
							asPulls(octokit).rest.pulls.requestReviewers({
								owner,
								repo,
								pull_number: number,
								...(options.reviewers ? { reviewers: [...options.reviewers] } : {}),
								...(options.teamReviewers ? { team_reviewers: [...options.teamReviewers] } : {}),
							}),
						),
					).pipe(
						Effect.asVoid,
						Effect.mapError(mapClientError("requestReviewers", number)),
						Effect.withSpan("PullRequest.requestReviewers", {
							attributes: { "pr.number": String(number) },
						}),
					),
			};
		}),
	),
);
