import { Effect, Layer } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitTagError } from "../errors/GitTagError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import type { TagRef } from "../services/GitTag.js";
import { GitTag } from "../services/GitTag.js";

/** Safety bound on tag-object dereference depth (a tag-of-a-tag chain). */
const MAX_TAG_PEEL = 5;

/** A tag entry from the repos.listTags endpoint (commit.sha is peeled). */
interface RawTag {
	readonly name: string;
	readonly commit: { readonly sha: string };
}

/** A git object reference (ref target or tag-object target). */
interface RawGitObject {
	readonly sha: string;
	readonly type: string;
}

/** Minimal Octokit shape for the tag API calls. */
interface OctokitGit {
	readonly rest: {
		readonly git: {
			readonly createRef: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
			readonly deleteRef: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
			readonly getRef: (args: Record<string, unknown>) => Promise<{ data: { ref: string; object: RawGitObject } }>;
			readonly getTag: (args: Record<string, unknown>) => Promise<{ data: { object: RawGitObject } }>;
		};
		readonly repos: {
			readonly listTags: (args: Record<string, unknown>) => Promise<{ data: Array<RawTag> }>;
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
	Effect.map(GitHubClient, (client): typeof GitTag.Service => {
		const peelToCommit = (
			owner: string,
			repo: string,
			tag: string,
			obj: RawGitObject,
		): Effect.Effect<string, GitTagError> =>
			Effect.iterate(
				{ sha: obj.sha, type: obj.type, depth: 0 },
				{
					while: (state) => state.type === "tag" && state.depth < MAX_TAG_PEEL,
					body: (state) =>
						client
							.rest("git.getTag", (octokit) => asGit(octokit).rest.git.getTag({ owner, repo, tag_sha: state.sha }))
							.pipe(
								Effect.map((data) => {
									const next = (data as { object: RawGitObject }).object;
									return { sha: next.sha, type: next.type, depth: state.depth + 1 };
								}),
								Effect.mapError(mapError("resolve", tag)),
							),
				},
			).pipe(
				Effect.flatMap((state) =>
					state.type === "commit"
						? Effect.succeed(state.sha)
						: Effect.fail(
								new GitTagError({
									operation: "resolve",
									tag,
									reason: `Tag peel exceeded ${MAX_TAG_PEEL} levels`,
								}),
							),
				),
			);

		return {
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
					client.paginate("repos.listTags", (octokit, page, perPage) =>
						asGit(octokit).rest.repos.listTags({ owner, repo, page, per_page: perPage }),
					),
				).pipe(
					Effect.map((items) => {
						const tags = (items as Array<RawTag>).map((item): TagRef => ({ tag: item.name, sha: item.commit.sha }));
						return prefix ? tags.filter((t) => t.tag.startsWith(prefix)) : tags;
					}),
					Effect.mapError(mapError("list")),
				),

			resolve: (tag) =>
				client.repo.pipe(
					Effect.mapError(mapError("resolve", tag)),
					Effect.flatMap(({ owner, repo }) =>
						client
							.rest("git.getRef", (octokit) => asGit(octokit).rest.git.getRef({ owner, repo, ref: `tags/${tag}` }))
							.pipe(
								Effect.map((data) => (data as { object: RawGitObject }).object),
								Effect.mapError(mapError("resolve", tag)),
								Effect.flatMap((obj) => peelToCommit(owner, repo, tag, obj)),
							),
					),
				),
		};
	}),
);
