import { Effect, Layer } from "effect";
import { GitCommitError } from "../errors/GitCommitError.js";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitCommit } from "../services/GitCommit.js";
import { GitHubClient } from "../services/GitHubClient.js";

const mapError =
	(operation: "tree" | "commit" | "ref") =>
	(error: GitHubClientError): GitCommitError =>
		new GitCommitError({ operation, reason: error.reason });

/** Minimal Octokit shape for git data API calls. */
interface OctokitGitData {
	readonly rest: {
		readonly git: {
			readonly createTree: (args: Record<string, unknown>) => Promise<{ data: { sha: string } }>;
			readonly createCommit: (args: Record<string, unknown>) => Promise<{ data: { sha: string } }>;
			readonly getRef: (args: Record<string, unknown>) => Promise<{ data: { object: { sha: string } } }>;
			readonly updateRef: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
		};
	};
}

const asGit = (octokit: unknown): OctokitGitData => octokit as OctokitGitData;

export const GitCommitLive: Layer.Layer<GitCommit, never, GitHubClient> = Layer.effect(
	GitCommit,
	Effect.map(GitHubClient, (client) => ({
		createTree: (entries, baseTree) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.createTree", (octokit) =>
					asGit(octokit).rest.git.createTree({
						owner,
						repo,
						tree: entries.map((e) =>
							"sha" in e
								? { path: e.path, mode: e.mode, sha: e.sha }
								: { path: e.path, mode: e.mode, type: "blob", content: e.content },
						),
						...(baseTree !== undefined ? { base_tree: baseTree } : {}),
					}),
				),
			).pipe(
				Effect.map((data) => (data as { sha: string }).sha),
				Effect.mapError(mapError("tree")),
				Effect.withSpan("GitCommit.createTree"),
			),

		createCommit: (message, treeSha, parentShas) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.createCommit", (octokit) =>
					asGit(octokit).rest.git.createCommit({
						owner,
						repo,
						message,
						tree: treeSha,
						parents: parentShas,
					}),
				),
			).pipe(
				Effect.map((data) => (data as { sha: string }).sha),
				Effect.mapError(mapError("commit")),
				Effect.withSpan("GitCommit.createCommit"),
			),

		updateRef: (ref, sha, force) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.updateRef", (octokit) =>
					asGit(octokit).rest.git.updateRef({
						owner,
						repo,
						ref: `heads/${ref}`,
						sha,
						force: force ?? false,
					}),
				),
			).pipe(
				Effect.asVoid,
				Effect.mapError(mapError("ref")),
				Effect.withSpan("GitCommit.updateRef", { attributes: { "git.ref": ref } }),
			),

		commitFiles: (branch, message, files) =>
			Effect.gen(function* () {
				const { owner, repo } = yield* client.repo.pipe(Effect.mapError(mapError("ref")));

				// 1. Get current SHA of the branch
				const refData = yield* client
					.rest("git.getRef", (octokit) =>
						asGit(octokit).rest.git.getRef({
							owner,
							repo,
							ref: `heads/${branch}`,
						}),
					)
					.pipe(Effect.mapError(mapError("ref")));

				const parentSha = (refData as { object: { sha: string } }).object.sha;

				// 2. Create tree from file changes
				const treeData = yield* client
					.rest("git.createTree", (octokit) =>
						asGit(octokit).rest.git.createTree({
							owner,
							repo,
							tree: files.map((f) =>
								"sha" in f
									? { path: f.path, mode: "100644" as const, sha: f.sha }
									: { path: f.path, mode: "100644" as const, type: "blob", content: f.content },
							),
							base_tree: parentSha,
						}),
					)
					.pipe(Effect.mapError(mapError("tree")));

				const treeSha = (treeData as { sha: string }).sha;

				// 3. Create commit
				const commitData = yield* client
					.rest("git.createCommit", (octokit) =>
						asGit(octokit).rest.git.createCommit({
							owner,
							repo,
							message,
							tree: treeSha,
							parents: [parentSha],
						}),
					)
					.pipe(Effect.mapError(mapError("commit")));

				const commitSha = (commitData as { sha: string }).sha;

				// 4. Update ref
				yield* client
					.rest("git.updateRef", (octokit) =>
						asGit(octokit).rest.git.updateRef({
							owner,
							repo,
							ref: `heads/${branch}`,
							sha: commitSha,
							force: false,
						}),
					)
					.pipe(Effect.mapError(mapError("ref")));

				return commitSha;
			}).pipe(Effect.withSpan("GitCommit.commitFiles", { attributes: { "git.branch": branch } })),
	})),
);
