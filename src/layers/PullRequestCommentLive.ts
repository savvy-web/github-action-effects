import { Effect, Layer, Option } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { PullRequestCommentError } from "../errors/PullRequestCommentError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import type { CommentRecord } from "../services/PullRequestComment.js";
import { PullRequestComment } from "../services/PullRequestComment.js";

/** Shape returned by the GitHub Issues API for a comment. */
interface GitHubComment {
	readonly id: number;
	readonly body: string | null;
}

/** Shape returned by comment create/update endpoints. */
interface GitHubCommentResponse {
	readonly id: number;
}

/** Minimal Octokit shape for issues comment API calls. */
interface OctokitIssues {
	readonly rest: {
		readonly issues: {
			readonly createComment: (args: Record<string, unknown>) => Promise<{ data: GitHubCommentResponse }>;
			readonly updateComment: (args: Record<string, unknown>) => Promise<{ data: GitHubCommentResponse }>;
			readonly listComments: (args: Record<string, unknown>) => Promise<{ data: Array<GitHubComment> }>;
			readonly deleteComment: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
		};
	};
}

const asIssues = (octokit: unknown): OctokitIssues => octokit as OctokitIssues;

const marker = (key: string): string => `<!-- savvy-web:${key} -->`;

const mapError =
	(prNumber: number, operation: "create" | "upsert" | "find" | "delete") =>
	(error: GitHubClientError): PullRequestCommentError =>
		new PullRequestCommentError({ prNumber, operation, reason: error.reason });

export const PullRequestCommentLive: Layer.Layer<PullRequestComment, never, GitHubClient> = Layer.effect(
	PullRequestComment,
	Effect.map(GitHubClient, (client) => ({
		create: (prNumber: number, body: string) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest<GitHubCommentResponse>("issues.createComment", (octokit) =>
					asIssues(octokit).rest.issues.createComment({
						owner,
						repo,
						issue_number: prNumber,
						body,
					}),
				),
			).pipe(
				Effect.map((data) => data.id),
				Effect.mapError(mapError(prNumber, "create")),
				Effect.withSpan("PullRequestComment.create", { attributes: { "pr.number": String(prNumber) } }),
			),

		upsert: (prNumber: number, markerKey: string, body: string) => {
			const markerTag = marker(markerKey);
			const bodyWithMarker = `${markerTag}\n${body}`;

			return Effect.flatMap(client.repo, ({ owner, repo }) =>
				client
					.rest<Array<GitHubComment>>("issues.listComments", (octokit) =>
						asIssues(octokit).rest.issues.listComments({
							owner,
							repo,
							issue_number: prNumber,
							per_page: 100,
						}),
					)
					.pipe(
						Effect.flatMap((comments) => {
							const existing = comments.find((c) => typeof c.body === "string" && c.body.includes(markerTag));

							if (existing) {
								return client
									.rest<GitHubCommentResponse>("issues.updateComment", (octokit) =>
										asIssues(octokit).rest.issues.updateComment({
											owner,
											repo,
											comment_id: existing.id,
											body: bodyWithMarker,
										}),
									)
									.pipe(Effect.map((data) => data.id));
							}

							return client
								.rest<GitHubCommentResponse>("issues.createComment", (octokit) =>
									asIssues(octokit).rest.issues.createComment({
										owner,
										repo,
										issue_number: prNumber,
										body: bodyWithMarker,
									}),
								)
								.pipe(Effect.map((data) => data.id));
						}),
					),
			).pipe(
				Effect.mapError(mapError(prNumber, "upsert")),
				Effect.withSpan("PullRequestComment.upsert", {
					attributes: { "pr.number": String(prNumber), "comment.marker": markerKey },
				}),
			);
		},

		find: (prNumber: number, markerKey: string) => {
			const markerTag = marker(markerKey);

			return Effect.flatMap(client.repo, ({ owner, repo }) =>
				client
					.rest<Array<GitHubComment>>("issues.listComments", (octokit) =>
						asIssues(octokit).rest.issues.listComments({
							owner,
							repo,
							issue_number: prNumber,
							per_page: 100,
						}),
					)
					.pipe(
						Effect.map((comments) => {
							const found = comments.find((c) => typeof c.body === "string" && c.body.includes(markerTag));
							if (found) {
								return Option.some({ id: found.id, body: found.body ?? "" } as CommentRecord);
							}
							return Option.none();
						}),
					),
			).pipe(
				Effect.mapError(mapError(prNumber, "find")),
				Effect.withSpan("PullRequestComment.find", {
					attributes: { "pr.number": String(prNumber), "comment.marker": markerKey },
				}),
			);
		},

		delete: (prNumber: number, commentId: number) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("issues.deleteComment", (octokit) =>
					asIssues(octokit).rest.issues.deleteComment({
						owner,
						repo,
						comment_id: commentId,
					}),
				),
			).pipe(
				Effect.asVoid,
				Effect.mapError(mapError(prNumber, "delete")),
				Effect.withSpan("PullRequestComment.delete", { attributes: { "pr.number": String(prNumber) } }),
			),
	})),
);
