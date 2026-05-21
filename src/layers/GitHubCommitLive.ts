import { Effect, Layer } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubCommitError } from "../errors/GitHubCommitError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import type { CommitComparison, CommitDetail, CommitSummary } from "../services/GitHubCommit.js";
import { GitHubCommit } from "../services/GitHubCommit.js";

interface RawCommitAuthor {
	readonly name?: string;
}
interface RawCommitMeta {
	readonly message: string;
	readonly author?: RawCommitAuthor;
}
interface RawListedCommit {
	readonly sha: string;
	readonly commit: RawCommitMeta;
}
interface RawCommit extends RawListedCommit {
	readonly parents: ReadonlyArray<{ readonly sha: string }>;
}
interface RawCommitFile {
	readonly filename: string;
	readonly status: string;
}
interface RawComparison {
	readonly commits: ReadonlyArray<RawListedCommit>;
	readonly files?: ReadonlyArray<RawCommitFile>;
}

/** Minimal Octokit shape for repo commit API calls. */
interface OctokitCommits {
	readonly rest: {
		readonly repos: {
			readonly getCommit: (args: Record<string, unknown>) => Promise<{ data: RawCommit }>;
			readonly listCommits: (args: Record<string, unknown>) => Promise<{ data: RawListedCommit[] }>;
			readonly compareCommits: (args: Record<string, unknown>) => Promise<{ data: RawComparison }>;
		};
	};
}

const asCommits = (octokit: unknown): OctokitCommits => octokit as OctokitCommits;

const toSummary = (raw: RawListedCommit): CommitSummary => ({
	sha: raw.sha,
	message: raw.commit.message,
	author: raw.commit.author?.name ?? "Unknown",
});

const toDetail = (raw: RawCommit): CommitDetail => ({
	...toSummary(raw),
	parents: raw.parents.map((p) => ({ sha: p.sha })),
});

const toComparison = (raw: RawComparison): CommitComparison => ({
	commits: raw.commits.map(toSummary),
	files: (raw.files ?? []).map((f) => ({ filename: f.filename, status: f.status })),
});

const mapClientError =
	(operation: GitHubCommitError["operation"], ref?: string) =>
	(error: GitHubClientError): GitHubCommitError =>
		new GitHubCommitError({
			operation,
			...(ref !== undefined ? { ref } : {}),
			reason: error.reason,
		});

export const GitHubCommitLive: Layer.Layer<GitHubCommit, never, GitHubClient> = Layer.effect(
	GitHubCommit,
	Effect.map(GitHubClient, (client) => ({
		get: (ref: string) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("repos.getCommit", (octokit) => asCommits(octokit).rest.repos.getCommit({ owner, repo, ref })),
			).pipe(
				Effect.map((data) => toDetail(data as unknown as RawCommit)),
				Effect.mapError(mapClientError("get", ref)),
			),

		list: (ref: string) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.paginate(
					"repos.listCommits",
					(octokit, page, perPage) =>
						asCommits(octokit).rest.repos.listCommits({ owner, repo, sha: ref, page, per_page: perPage }),
					{},
				),
			).pipe(
				Effect.map((items) => (items as unknown as RawListedCommit[]).map(toSummary)),
				Effect.mapError(mapClientError("list", ref)),
			),

		compare: (base: string, head: string) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("repos.compareCommits", (octokit) =>
					asCommits(octokit).rest.repos.compareCommits({ owner, repo, base, head }),
				),
			).pipe(
				Effect.map((data) => toComparison(data as unknown as RawComparison)),
				Effect.mapError(mapClientError("compare", `${base}...${head}`)),
			),
	})),
);
