import { Effect, Layer } from "effect";
import { GitBranchError } from "../errors/GitBranchError.js";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitBranch } from "../services/GitBranch.js";
import { GitHubClient } from "../services/GitHubClient.js";

const mapError =
	(branch: string, operation: "create" | "delete" | "get" | "reset") =>
	(error: GitHubClientError): GitBranchError =>
		new GitBranchError({ branch, operation, reason: error.reason });

/** Minimal Octokit shape for git refs API calls. */
interface OctokitGit {
	readonly rest: {
		readonly git: {
			readonly createRef: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
			readonly getRef: (args: Record<string, unknown>) => Promise<{ data: { object: { sha: string } } }>;
			readonly deleteRef: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
			readonly updateRef: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
		};
	};
}

const asGit = (octokit: unknown): OctokitGit => octokit as OctokitGit;

export const GitBranchLive: Layer.Layer<GitBranch, never, GitHubClient> = Layer.effect(
	GitBranch,
	Effect.map(GitHubClient, (client) => ({
		create: (name, sha) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.createRef", (octokit) =>
					asGit(octokit).rest.git.createRef({
						owner,
						repo,
						ref: `refs/heads/${name}`,
						sha,
					}),
				),
			).pipe(
				Effect.asVoid,
				Effect.mapError(mapError(name, "create")),
				Effect.withSpan("GitBranch.create", { attributes: { "branch.name": name } }),
			),

		exists: (name) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.getRef", (octokit) =>
					asGit(octokit).rest.git.getRef({
						owner,
						repo,
						ref: `heads/${name}`,
					}),
				),
			).pipe(
				Effect.map(() => true),
				Effect.catchAll((error) => {
					if (error.status === 404) {
						return Effect.succeed(false);
					}
					return Effect.fail(new GitBranchError({ branch: name, operation: "get", reason: error.reason }));
				}),
				Effect.withSpan("GitBranch.exists", { attributes: { "branch.name": name } }),
			),

		delete: (name) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.deleteRef", (octokit) =>
					asGit(octokit).rest.git.deleteRef({
						owner,
						repo,
						ref: `heads/${name}`,
					}),
				),
			).pipe(
				Effect.asVoid,
				Effect.mapError(mapError(name, "delete")),
				Effect.withSpan("GitBranch.delete", { attributes: { "branch.name": name } }),
			),

		getSha: (name) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.getRef", (octokit) =>
					asGit(octokit).rest.git.getRef({
						owner,
						repo,
						ref: `heads/${name}`,
					}),
				),
			).pipe(
				Effect.map((data) => (data as { object: { sha: string } }).object.sha),
				Effect.mapError(mapError(name, "get")),
				Effect.withSpan("GitBranch.getSha", { attributes: { "branch.name": name } }),
			),

		reset: (name, sha) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("git.updateRef", (octokit) =>
					asGit(octokit).rest.git.updateRef({
						owner,
						repo,
						ref: `heads/${name}`,
						sha,
						force: true,
					}),
				),
			).pipe(
				Effect.asVoid,
				Effect.mapError(mapError(name, "reset")),
				Effect.withSpan("GitBranch.reset", { attributes: { "branch.name": name } }),
			),
	})),
);
