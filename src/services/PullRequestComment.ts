import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { PullRequestCommentError } from "../errors/PullRequestCommentError.js";

/**
 * A PR comment record.
 *
 * @public
 */
export interface CommentRecord {
	readonly id: number;
	readonly body: string;
}

/**
 * Service for PR comment operations.
 *
 * @public
 */
export class PullRequestComment extends Context.Tag("github-action-effects/PullRequestComment")<
	PullRequestComment,
	{
		/** Create a new comment on a PR. Returns the comment ID. */
		readonly create: (prNumber: number, body: string) => Effect.Effect<number, PullRequestCommentError>;

		/**
		 * Create or update a sticky comment identified by a marker key.
		 * Uses a hidden HTML marker: `<!-- savvy-web:key -->`
		 * If a comment with the marker exists, updates it. Otherwise creates new.
		 * Returns the comment ID.
		 */
		readonly upsert: (
			prNumber: number,
			markerKey: string,
			body: string,
		) => Effect.Effect<number, PullRequestCommentError>;

		/** Find a comment by marker key. Returns Option. */
		readonly find: (
			prNumber: number,
			markerKey: string,
		) => Effect.Effect<Option.Option<CommentRecord>, PullRequestCommentError>;

		/** Delete a comment by ID. */
		readonly delete: (prNumber: number, commentId: number) => Effect.Effect<void, PullRequestCommentError>;
	}
>() {}
