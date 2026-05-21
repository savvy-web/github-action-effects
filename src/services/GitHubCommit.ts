import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubCommitError } from "../errors/GitHubCommitError.js";

/**
 * A commit summary as returned by list and compare.
 *
 * @public
 */
export interface CommitSummary {
	readonly sha: string;
	readonly message: string;
	readonly author: string;
}

/**
 * A single commit with its parent SHAs.
 *
 * @public
 */
export interface CommitDetail extends CommitSummary {
	readonly parents: ReadonlyArray<{ readonly sha: string }>;
}

/**
 * A file changed between two commits/refs.
 *
 * @public
 */
export interface CommitFile {
	readonly filename: string;
	readonly status: string;
}

/**
 * Result of comparing two commits/refs (base...head).
 *
 * @public
 */
export interface CommitComparison {
	readonly commits: ReadonlyArray<CommitSummary>;
	readonly files: ReadonlyArray<CommitFile>;
}

/**
 * Service for reading the GitHub commit graph.
 *
 * @remarks
 * Distinct from `GitCommit`, which wraps the local `git` CLI. This service
 * wraps the GitHub REST API (`repos.getCommit` / `listCommits` /
 * `compareCommits`).
 *
 * @public
 */
export class GitHubCommit extends Context.Tag("github-action-effects/GitHubCommit")<
	GitHubCommit,
	{
		/** Get a single commit by ref (SHA or branch name). */
		readonly get: (ref: string) => Effect.Effect<CommitDetail, GitHubCommitError>;

		/** List commits reachable from a ref, paginated. */
		readonly list: (ref: string) => Effect.Effect<ReadonlyArray<CommitSummary>, GitHubCommitError>;

		/** Compare two commits/refs; returns the commits and changed files between base and head. */
		readonly compare: (base: string, head: string) => Effect.Effect<CommitComparison, GitHubCommitError>;
	}
>() {}
