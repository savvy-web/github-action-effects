import { Effect, Layer } from "effect";
import type { TreeEntry } from "../schemas/GitTree.js";
import { GitCommit } from "../services/GitCommit.js";

/**
 * Test state for GitCommit.
 *
 * @public
 */
export interface GitCommitTestState {
	readonly trees: Array<{ entries: Array<TreeEntry>; baseTree?: string; sha: string }>;
	readonly commits: Array<{
		message: string;
		treeSha: string;
		parentShas: Array<string>;
		sha: string;
	}>;
	readonly refUpdates: Array<{ ref: string; sha: string; force?: boolean }>;
}

const makeTestGitCommit = (state: GitCommitTestState): GitCommit => {
	let treeCounter = 0;
	let commitCounter = 0;

	return {
		createTree: (entries, baseTree) =>
			Effect.sync(() => {
				treeCounter++;
				const sha = `tree-sha-${treeCounter}`;
				const record: { entries: Array<TreeEntry>; baseTree?: string; sha: string } = { entries, sha };
				if (baseTree !== undefined) {
					record.baseTree = baseTree;
				}
				state.trees.push(record);
				return sha;
			}),

		createCommit: (message, treeSha, parentShas) =>
			Effect.sync(() => {
				commitCounter++;
				const sha = `commit-sha-${commitCounter}`;
				state.commits.push({ message, treeSha, parentShas, sha });
				return sha;
			}),

		updateRef: (ref, sha, force) =>
			Effect.sync(() => {
				const record: { ref: string; sha: string; force?: boolean } = { ref, sha };
				if (force !== undefined) {
					record.force = force;
				}
				state.refUpdates.push(record);
			}),

		commitFiles: (branch, message, files) =>
			Effect.sync(() => {
				treeCounter++;
				const treeSha = `tree-sha-${treeCounter}`;
				state.trees.push({
					entries: files.map((f) =>
						"sha" in f
							? { path: f.path, mode: "100644" as const, sha: f.sha }
							: { path: f.path, mode: "100644" as const, content: f.content },
					),
					baseTree: `parent-of-${branch}`,
					sha: treeSha,
				});

				commitCounter++;
				const commitSha = `commit-sha-${commitCounter}`;
				state.commits.push({
					message,
					treeSha,
					parentShas: [`parent-of-${branch}`],
					sha: commitSha,
				});

				state.refUpdates.push({ ref: branch, sha: commitSha, force: false });

				return commitSha;
			}),
	};
};

/**
 * Test implementation for GitCommit.
 *
 * @public
 */
export const GitCommitTest = {
	/** Create test layer that records git commit operations. */
	layer: (state: GitCommitTestState): Layer.Layer<GitCommit> => Layer.succeed(GitCommit, makeTestGitCommit(state)),

	/** Create a fresh test state. */
	empty: (): GitCommitTestState => ({
		trees: [],
		commits: [],
		refUpdates: [],
	}),
} as const;
