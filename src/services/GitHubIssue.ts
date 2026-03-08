import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubIssueError } from "../errors/GitHubIssueError.js";

/**
 * Data returned from a GitHub issue.
 *
 * @public
 */
export interface IssueData {
	readonly number: number;
	readonly title: string;
	readonly state: string;
	readonly labels: Array<string>;
}

/**
 * Service interface for GitHub Issue operations.
 *
 * @public
 */
export interface GitHubIssue {
	/** List issues, optionally filtered by state, labels, or milestone. */
	readonly list: (options?: {
		readonly state?: "open" | "closed" | "all";
		readonly labels?: Array<string>;
		readonly milestone?: number;
		readonly perPage?: number;
		readonly maxPages?: number;
	}) => Effect.Effect<Array<IssueData>, GitHubIssueError>;

	/** Close an issue with an optional reason. */
	readonly close: (issueNumber: number, reason?: "completed" | "not_planned") => Effect.Effect<void, GitHubIssueError>;

	/** Add a comment to an issue. */
	readonly comment: (issueNumber: number, body: string) => Effect.Effect<{ id: number }, GitHubIssueError>;

	/** Get issues linked to a pull request via closing references. */
	readonly getLinkedIssues: (
		prNumber: number,
	) => Effect.Effect<Array<{ number: number; title: string }>, GitHubIssueError>;
}

/**
 * GitHubIssue tag for dependency injection.
 *
 * @public
 */
export const GitHubIssue = Context.GenericTag<GitHubIssue>("GitHubIssue");
