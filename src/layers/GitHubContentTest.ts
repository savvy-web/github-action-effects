import { Effect, Layer } from "effect";
import { GitHubContentError } from "../errors/GitHubContentError.js";
import { GitHubContent } from "../services/GitHubContent.js";

/**
 * Test state for GitHubContent.
 *
 * @public
 */
export interface GitHubContentTestState {
	/**
	 * File contents (already decoded) returned by `getFile`, keyed by
	 * `${ref ?? ""}:${path}`. Seed with the decoded text, e.g.
	 * `files.set("base-sha:pkg/package.json", JSON.stringify({ version: "1.0.0" }))`.
	 */
	readonly files: Map<string, string>;
}

const makeTestGitHubContent = (state: GitHubContentTestState): typeof GitHubContent.Service => ({
	getFile: (path, ref) =>
		Effect.sync(() => state.files.get(`${ref ?? ""}:${path}`)).pipe(
			Effect.flatMap((contents) =>
				contents !== undefined
					? Effect.succeed(contents)
					: Effect.fail(new GitHubContentError({ operation: "getFile", path, reason: "File not found" })),
			),
		),
});

/**
 * Test implementation for GitHubContent.
 *
 * @public
 */
export const GitHubContentTest = {
	/** Create test layer that serves seeded file contents. */
	layer: (state: GitHubContentTestState): Layer.Layer<GitHubContent> =>
		Layer.succeed(GitHubContent, makeTestGitHubContent(state)),

	/** Create a fresh test state. */
	empty: (): GitHubContentTestState => ({ files: new Map() }),
} as const;
