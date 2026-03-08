import { Effect, Layer } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubIssueError } from "../errors/GitHubIssueError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubGraphQL } from "../services/GitHubGraphQL.js";
import type { IssueData } from "../services/GitHubIssue.js";
import { GitHubIssue } from "../services/GitHubIssue.js";

/** Minimal Octokit shape for issues API calls. */
interface OctokitIssues {
	readonly rest: {
		readonly issues: {
			readonly listForRepo: (args: Record<string, unknown>) => Promise<{ data: RawIssue[] }>;
			readonly update: (args: Record<string, unknown>) => Promise<{ data: RawIssue }>;
			readonly createComment: (args: Record<string, unknown>) => Promise<{ data: { id: number } }>;
		};
	};
}

interface RawIssue {
	readonly number: number;
	readonly title: string;
	readonly state: string;
	readonly labels: Array<{ name?: string } | string>;
}

interface LinkedIssuesResponse {
	readonly repository: {
		readonly pullRequest: {
			readonly closingIssuesReferences: {
				readonly nodes: Array<{ number: number; title: string }>;
			};
		};
	};
}

const LINKED_ISSUES_QUERY = `query GetLinkedIssues($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      closingIssuesReferences(first: 50) {
        nodes { number title }
      }
    }
  }
}`;

const asIssues = (octokit: unknown): OctokitIssues => octokit as OctokitIssues;

const toIssueData = (raw: RawIssue): IssueData => ({
	number: raw.number,
	title: raw.title,
	state: raw.state,
	labels: raw.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
});

const mapClientError =
	(operation: "list" | "close" | "comment", issueNumber?: number) =>
	(error: GitHubClientError): GitHubIssueError =>
		new GitHubIssueError({
			operation,
			...(issueNumber !== undefined ? { issueNumber } : {}),
			reason: error.reason,
			retryable: error.retryable,
		});

export const GitHubIssueLive: Layer.Layer<GitHubIssue, never, GitHubClient | GitHubGraphQL> = Layer.effect(
	GitHubIssue,
	Effect.all([GitHubClient, GitHubGraphQL]).pipe(
		Effect.map(([client, graphql]) => ({
			list: (options) =>
				Effect.flatMap(client.repo, ({ owner, repo }) =>
					client.paginate(
						"issues.listForRepo",
						(octokit, page, perPage) =>
							asIssues(octokit).rest.issues.listForRepo({
								owner,
								repo,
								state: options?.state ?? "open",
								...(options?.labels?.length ? { labels: options.labels.join(",") } : {}),
								...(options?.milestone !== undefined ? { milestone: options.milestone } : {}),
								page,
								per_page: perPage,
							}),
						{
							...(options?.perPage !== undefined ? { perPage: options.perPage } : {}),
							...(options?.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
						},
					),
				).pipe(
					Effect.map((items) => items.map((item) => toIssueData(item as unknown as RawIssue))),
					Effect.mapError(mapClientError("list")),
					Effect.withSpan("GitHubIssue.list"),
				),

			close: (issueNumber, reason) =>
				Effect.flatMap(client.repo, ({ owner, repo }) =>
					client.rest("issues.update", (octokit) =>
						asIssues(octokit).rest.issues.update({
							owner,
							repo,
							issue_number: issueNumber,
							state: "closed",
							...(reason !== undefined ? { state_reason: reason } : {}),
						}),
					),
				).pipe(
					Effect.asVoid,
					Effect.mapError(mapClientError("close", issueNumber)),
					Effect.withSpan("GitHubIssue.close", {
						attributes: { "issue.number": String(issueNumber) },
					}),
				),

			comment: (issueNumber, body) =>
				Effect.flatMap(client.repo, ({ owner, repo }) =>
					client.rest("issues.createComment", (octokit) =>
						asIssues(octokit).rest.issues.createComment({
							owner,
							repo,
							issue_number: issueNumber,
							body,
						}),
					),
				).pipe(
					Effect.map((data) => ({ id: (data as unknown as { id: number }).id })),
					Effect.mapError(mapClientError("comment", issueNumber)),
					Effect.withSpan("GitHubIssue.comment", {
						attributes: { "issue.number": String(issueNumber) },
					}),
				),

			getLinkedIssues: (prNumber) =>
				Effect.flatMap(client.repo, ({ owner, repo }) =>
					graphql.query<LinkedIssuesResponse>("getLinkedIssues", LINKED_ISSUES_QUERY, {
						owner,
						repo,
						prNumber,
					}),
				).pipe(
					Effect.map((data) => data.repository.pullRequest.closingIssuesReferences.nodes),
					Effect.mapError(
						(error) =>
							new GitHubIssueError({
								operation: "getLinkedIssues",
								reason: error.reason,
								retryable: false,
							}),
					),
					Effect.withSpan("GitHubIssue.getLinkedIssues", {
						attributes: { "pr.number": String(prNumber) },
					}),
				),
		})),
	),
);
