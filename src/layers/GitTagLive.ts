import { Effect, Layer } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitTagError } from "../errors/GitTagError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import type { TagRef } from "../services/GitTag.js";
import { GitTag } from "../services/GitTag.js";

/** Minimal Octokit shape for git refs API calls (tags). */
interface OctokitGit {
	readonly rest: {
		readonly git: {
			readonly createRef: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
			readonly deleteRef: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
			readonly getRef: (args: Record<string, unknown>) => Promise<{ data: { ref: string; object: { sha: string } } }>;
			readonly listMatchingRefs: (
				args: Record<string, unknown>,
			) => Promise<{ data: Array<{ ref: string; object: { sha: string } }> }>;
		};
	};
}

const asGit = (octokit: unknown): OctokitGit => octokit as OctokitGit;

const mapError =
	(operation: "create" | "delete" | "list" | "resolve", tag?: string) =>
	(error: GitHubClientError): GitTagError =>
		new GitTagError({
			operation,
			...(tag !== undefined ? { tag } : {}),
			reason: error.reason,
		});

export const GitTagLive: Layer.Layer<GitTag, never, GitHubClient> = Layer.effect(
	GitTag,
	Effect.map(GitHubClient, (client) => ({
		create: (tag, sha) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.createRef", (octokit) =>
					asGit(octokit).rest.git.createRef({
						owner,
						repo,
						ref: `refs/tags/${tag}`,
						sha,
					}),
				),
			).pipe(Effect.asVoid, Effect.mapError(mapError("create", tag))),

		delete: (tag) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.deleteRef", (octokit) =>
					asGit(octokit).rest.git.deleteRef({
						owner,
						repo,
						ref: `tags/${tag}`,
					}),
				),
			).pipe(Effect.asVoid, Effect.mapError(mapError("delete", tag))),

		list: (prefix) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.paginate("git.listMatchingRefs", (octokit, page, perPage) =>
					asGit(octokit).rest.git.listMatchingRefs({
						owner,
						repo,
						ref: `tags/${prefix ?? ""}`,
						page,
						per_page: perPage,
					}),
				),
			).pipe(
				Effect.map((items) =>
					(items as Array<{ ref: string; object: { sha: string } }>).map(
						(item): TagRef => ({
							tag: item.ref.replace("refs/tags/", ""),
							sha: item.object.sha,
						}),
					),
				),
				Effect.mapError(mapError("list")),
			),

		resolve: (tag) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.getRef", (octokit) =>
					asGit(octokit).rest.git.getRef({
						owner,
						repo,
						ref: `tags/${tag}`,
					}),
				),
			).pipe(
				Effect.map((data) => (data as { object: { sha: string } }).object.sha),
				Effect.mapError(mapError("resolve", tag)),
			),
	})),
);
