import { Effect, Layer, Option } from "effect";
import type { CommentRecord } from "../services/PullRequestComment.js";
import { PullRequestComment } from "../services/PullRequestComment.js";

/**
 * In-memory comment storage for testing.
 *
 * @public
 */
export interface PullRequestCommentTestState {
	readonly comments: Map<number, Array<{ id: number; body: string }>>;
	nextId: number;
}

const marker = (key: string): string => `<!-- savvy-web:${key} -->`;

const makeTestPRComment = (state: PullRequestCommentTestState): PullRequestComment => ({
	create: (prNumber, body) =>
		Effect.sync(() => {
			const id = state.nextId++;
			const prComments = state.comments.get(prNumber) ?? [];
			prComments.push({ id, body });
			state.comments.set(prNumber, prComments);
			return id;
		}),

	upsert: (prNumber, markerKey, body) =>
		Effect.sync(() => {
			const markerTag = marker(markerKey);
			const bodyWithMarker = `${markerTag}\n${body}`;
			const prComments = state.comments.get(prNumber) ?? [];
			const existing = prComments.find((c) => c.body.includes(markerTag));

			if (existing) {
				existing.body = bodyWithMarker;
				return existing.id;
			}

			const id = state.nextId++;
			prComments.push({ id, body: bodyWithMarker });
			state.comments.set(prNumber, prComments);
			return id;
		}),

	find: (prNumber, markerKey) =>
		Effect.sync(() => {
			const markerTag = marker(markerKey);
			const prComments = state.comments.get(prNumber) ?? [];
			const found = prComments.find((c) => c.body.includes(markerTag));
			if (found) {
				return Option.some({ id: found.id, body: found.body } as CommentRecord);
			}
			return Option.none();
		}),

	delete: (_prNumber, commentId) =>
		Effect.sync(() => {
			for (const [prNum, prComments] of state.comments.entries()) {
				const index = prComments.findIndex((c) => c.id === commentId);
				if (index >= 0) {
					prComments.splice(index, 1);
					state.comments.set(prNum, prComments);
					return;
				}
			}
		}),
});

/**
 * Test implementation for PullRequestComment.
 *
 * @public
 */
export const PullRequestCommentTest = {
	/**
	 * Create a fresh empty test state container.
	 */
	empty: (): PullRequestCommentTestState => ({
		comments: new Map(),
		nextId: 1,
	}),

	/**
	 * Create a test layer from the given state.
	 */
	layer: (state: PullRequestCommentTestState): Layer.Layer<PullRequestComment> =>
		Layer.succeed(PullRequestComment, makeTestPRComment(state)),
} as const;
