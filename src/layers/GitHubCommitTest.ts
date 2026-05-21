import { Effect, Layer } from "effect";
import { GitHubCommitError } from "../errors/GitHubCommitError.js";
import type { CommitComparison, CommitDetail, CommitSummary } from "../services/GitHubCommit.js";
import { GitHubCommit } from "../services/GitHubCommit.js";

/**
 * Test state for GitHubCommit.
 *
 * @public
 */
export interface GitHubCommitTestState {
	/** Commits by ref, returned by get. */
	readonly commits: Map<string, CommitDetail>;
	/** Commit lists by ref, returned by list. */
	readonly commitLists: Map<string, ReadonlyArray<CommitSummary>>;
	/** Comparisons keyed by `${base}...${head}`, returned by compare. */
	readonly comparisons: Map<string, CommitComparison>;
}

const makeTestGitHubCommit = (state: GitHubCommitTestState): typeof GitHubCommit.Service => ({
	get: (ref) =>
		Effect.sync(() => state.commits.get(ref)).pipe(
			Effect.flatMap((commit) =>
				commit
					? Effect.succeed(commit)
					: Effect.fail(new GitHubCommitError({ operation: "get", ref, reason: "Commit not found" })),
			),
		),

	list: (ref) => Effect.succeed(state.commitLists.get(ref) ?? []),

	compare: (base, head) => Effect.succeed(state.comparisons.get(`${base}...${head}`) ?? { commits: [], files: [] }),
});

/**
 * Test implementation for GitHubCommit.
 *
 * @public
 */
export const GitHubCommitTest = {
	/** Create test layer that serves seeded commit data. */
	layer: (state: GitHubCommitTestState): Layer.Layer<GitHubCommit> =>
		Layer.succeed(GitHubCommit, makeTestGitHubCommit(state)),

	/** Create a fresh test state. */
	empty: (): GitHubCommitTestState => ({
		commits: new Map(),
		commitLists: new Map(),
		comparisons: new Map(),
	}),
} as const;
