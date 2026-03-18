import { Effect, Layer } from "effect";
import { GitBranchError } from "../errors/GitBranchError.js";
import { GitBranch } from "../services/GitBranch.js";

/**
 * Test state for GitBranch.
 *
 * @public
 */
export interface GitBranchTestState {
	readonly branches: Map<string, string>;
}

const makeTestGitBranch = (state: GitBranchTestState): typeof GitBranch.Service => ({
	create: (name, sha) =>
		Effect.sync(() => {
			state.branches.set(name, sha);
		}),

	exists: (name) => Effect.succeed(state.branches.has(name)),

	delete: (name) =>
		Effect.sync(() => {
			state.branches.delete(name);
		}),

	getSha: (name) => {
		const sha = state.branches.get(name);
		if (sha === undefined) {
			return Effect.fail(
				new GitBranchError({
					branch: name,
					operation: "get",
					reason: `Branch ${name} not found`,
				}),
			);
		}
		return Effect.succeed(sha);
	},

	reset: (name, sha) =>
		Effect.sync(() => {
			state.branches.set(name, sha);
		}),
});

/**
 * Test implementation for GitBranch.
 *
 * @public
 */
export const GitBranchTest = {
	/** Create test layer that records branch operations. */
	layer: (state: GitBranchTestState): Layer.Layer<GitBranch> => Layer.succeed(GitBranch, makeTestGitBranch(state)),

	/** Create a fresh test state. */
	empty: (): GitBranchTestState => ({
		branches: new Map(),
	}),
} as const;
