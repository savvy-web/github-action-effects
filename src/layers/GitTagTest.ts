import { Effect, Layer } from "effect";
import { GitTagError } from "../errors/GitTagError.js";
import type { GitTag, TagRef } from "../services/GitTag.js";
import { GitTag as GitTagTag } from "../services/GitTag.js";

/**
 * Test state for GitTag.
 *
 * @public
 */
export interface GitTagTestState {
	readonly tags: Map<string, string>;
	readonly createCalls: Array<{ tag: string; sha: string }>;
	readonly deleteCalls: Array<string>;
}

const makeTestClient = (state: GitTagTestState): GitTag => ({
	create: (tag, sha) => {
		state.createCalls.push({ tag, sha });
		state.tags.set(tag, sha);
		return Effect.void;
	},

	delete: (tag) => {
		if (!state.tags.has(tag)) {
			return Effect.fail(
				new GitTagError({
					operation: "delete",
					tag,
					reason: `Tag "${tag}" not found`,
				}),
			);
		}
		state.deleteCalls.push(tag);
		state.tags.delete(tag);
		return Effect.void;
	},

	list: (prefix) => {
		const entries: Array<TagRef> = [];
		for (const [tag, sha] of state.tags) {
			if (!prefix || tag.startsWith(prefix)) {
				entries.push({ tag, sha });
			}
		}
		return Effect.succeed(entries);
	},

	resolve: (tag) => {
		const sha = state.tags.get(tag);
		if (!sha) {
			return Effect.fail(
				new GitTagError({
					operation: "resolve",
					tag,
					reason: `Tag "${tag}" not found`,
				}),
			);
		}
		return Effect.succeed(sha);
	},
});

/**
 * Test implementation for GitTag.
 *
 * @public
 */
export const GitTagTest = {
	/** Create test layer with recorded tag state. */
	layer: (state: GitTagTestState): Layer.Layer<GitTag> => Layer.succeed(GitTagTag, makeTestClient(state)),

	/** Create a fresh test state and layer. */
	empty: (): { state: GitTagTestState; layer: Layer.Layer<GitTag> } => {
		const state: GitTagTestState = {
			tags: new Map(),
			createCalls: [],
			deleteCalls: [],
		};
		return { state, layer: Layer.succeed(GitTagTag, makeTestClient(state)) };
	},
} as const;
