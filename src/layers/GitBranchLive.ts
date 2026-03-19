import { Duration, Effect, Layer, Schedule } from "effect";
import { GitBranchError } from "../errors/GitBranchError.js";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitBranch } from "../services/GitBranch.js";
import { GitHubClient } from "../services/GitHubClient.js";

const mapError =
	(branch: string, operation: "create" | "delete" | "get" | "reset") =>
	(error: GitHubClientError): GitBranchError =>
		new GitBranchError({ branch, operation, reason: error.reason });

/** Retry schedule for transient GitHub API errors (3 retries, exponential backoff from 1s). */
const retrySchedule = Schedule.intersect(Schedule.exponential(Duration.seconds(1)), Schedule.recurs(3));

/** Retry an effect when the GitHubClientError is marked retryable. */
const retryOnTransient = <A>(effect: Effect.Effect<A, GitHubClientError>): Effect.Effect<A, GitHubClientError> =>
	effect.pipe(
		Effect.retry({
			schedule: retrySchedule,
			while: (error) => error.retryable,
		}),
	);

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
			).pipe(Effect.asVoid, retryOnTransient, Effect.mapError(mapError(name, "create"))),

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
			).pipe(Effect.asVoid, retryOnTransient, Effect.mapError(mapError(name, "delete"))),

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
			).pipe(Effect.asVoid, retryOnTransient, Effect.mapError(mapError(name, "reset"))),
	})),
);
