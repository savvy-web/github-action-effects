import type { Effect } from "effect";
import { Context } from "effect";
import type { PullRequestError } from "../errors/PullRequestError.js";

/**
 * A file changed in a pull request.
 *
 * @public
 */
export interface PullRequestFile {
	readonly filename: string;
	readonly status: string;
}

/**
 * Information about a pull request.
 *
 * @public
 */
export interface PullRequestInfo {
	readonly number: number;
	readonly url: string;
	readonly nodeId: string;
	readonly title: string;
	readonly state: "open" | "closed";
	readonly head: string;
	readonly base: string;
	readonly draft: boolean;
	readonly merged: boolean;
	/** ISO-8601 merge timestamp; `null` when not merged, absent from test fixtures that do not set it. */
	readonly mergedAt?: string | null;
	/** The PR description body; `null` when empty. */
	readonly body?: string | null;
	/** SHA of the merge commit; `null` when not merged. */
	readonly mergeCommitSha?: string | null;
	/** The base branch's commit SHA. */
	readonly baseSha?: string;
}

/**
 * Options for listing pull requests.
 *
 * @public
 */
export interface PullRequestListOptions {
	/** Filter by head branch (e.g. "owner:branch" or just "branch"). */
	readonly head?: string;
	/** Filter by base branch. */
	readonly base?: string;
	/** Filter by state. Defaults to "open". */
	readonly state?: "open" | "closed" | "all";
	/** Results per page. Defaults to 30. */
	readonly perPage?: number;
	/** When true, fetches all pages. Defaults to false. */
	readonly paginate?: boolean;
}

/**
 * Service for pull request lifecycle management.
 *
 * @public
 */
export class PullRequest extends Context.Tag("github-action-effects/PullRequest")<
	PullRequest,
	{
		/** Get a single PR by number. */
		readonly get: (number: number) => Effect.Effect<PullRequestInfo, PullRequestError>;

		/** List PRs matching filters. */
		readonly list: (
			options?: PullRequestListOptions,
		) => Effect.Effect<ReadonlyArray<PullRequestInfo>, PullRequestError>;

		/** List the files changed in a pull request. */
		readonly listFiles: (number: number) => Effect.Effect<Array<PullRequestFile>, PullRequestError>;

		/** List pull requests associated with a commit SHA. */
		readonly listAssociatedWithCommit: (sha: string) => Effect.Effect<Array<PullRequestInfo>, PullRequestError>;

		/** Create a new PR. */
		readonly create: (options: {
			readonly title: string;
			readonly body: string;
			readonly head: string;
			readonly base: string;
			readonly draft?: boolean;
			readonly autoMerge?: "merge" | "squash" | "rebase" | false;
		}) => Effect.Effect<PullRequestInfo, PullRequestError>;

		/** Update an existing PR. */
		readonly update: (
			number: number,
			options: {
				readonly title?: string;
				readonly body?: string;
				readonly state?: "open" | "closed";
				readonly autoMerge?: "merge" | "squash" | "rebase" | false;
			},
		) => Effect.Effect<PullRequestInfo, PullRequestError>;

		/**
		 * Find existing PR for head→base or create one; updates title/body if found.
		 *
		 * Note: `draft` is only applied when creating a new PR; it is not changed
		 * on an existing PR found via the update path.
		 */
		readonly getOrCreate: (options: {
			readonly head: string;
			readonly base: string;
			readonly title: string;
			readonly body: string;
			readonly draft?: boolean;
			readonly autoMerge?: "merge" | "squash" | "rebase" | false;
		}) => Effect.Effect<PullRequestInfo & { readonly created: boolean }, PullRequestError>;

		/** Immediately merge a PR. */
		readonly merge: (
			number: number,
			options?: {
				readonly method?: "merge" | "squash" | "rebase";
				readonly commitTitle?: string;
				readonly commitMessage?: string;
			},
		) => Effect.Effect<void, PullRequestError>;

		/** Add labels to a PR. */
		readonly addLabels: (number: number, labels: ReadonlyArray<string>) => Effect.Effect<void, PullRequestError>;

		/** Request reviewers for a PR. */
		readonly requestReviewers: (
			number: number,
			options: {
				readonly reviewers?: ReadonlyArray<string>;
				readonly teamReviewers?: ReadonlyArray<string>;
			},
		) => Effect.Effect<void, PullRequestError>;
	}
>() {}
