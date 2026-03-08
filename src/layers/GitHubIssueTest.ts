import { Effect, Layer } from "effect";
import { GitHubIssueError } from "../errors/GitHubIssueError.js";
import type { GitHubIssue, IssueData } from "../services/GitHubIssue.js";
import { GitHubIssue as GitHubIssueTag } from "../services/GitHubIssue.js";

/**
 * Test state for GitHubIssue.
 *
 * @public
 */
export interface GitHubIssueTestState {
	readonly issues: Map<number, IssueData>;
	readonly comments: Array<{ issueNumber: number; body: string }>;
	readonly closeCalls: Array<{ issueNumber: number; reason?: string }>;
	readonly linkedIssues: Map<number, Array<{ number: number; title: string }>>;
}

const makeTestClient = (state: GitHubIssueTestState): GitHubIssue => ({
	list: (options) => {
		let issues = Array.from(state.issues.values());
		if (options?.state && options.state !== "all") {
			issues = issues.filter((i) => i.state === options.state);
		}
		if (options?.labels?.length) {
			const filterLabels = options.labels;
			issues = issues.filter((i) => filterLabels.some((l) => i.labels.includes(l)));
		}
		return Effect.succeed(issues);
	},

	close: (issueNumber, reason) => {
		const issue = state.issues.get(issueNumber);
		if (!issue) {
			return Effect.fail(
				new GitHubIssueError({
					operation: "close",
					issueNumber,
					reason: `Issue #${issueNumber} not found`,
					retryable: false,
				}),
			);
		}
		state.closeCalls.push({ issueNumber, ...(reason !== undefined ? { reason } : {}) });
		state.issues.set(issueNumber, { ...issue, state: "closed" });
		return Effect.void;
	},

	comment: (issueNumber, body) => {
		if (!state.issues.has(issueNumber)) {
			return Effect.fail(
				new GitHubIssueError({
					operation: "comment",
					issueNumber,
					reason: `Issue #${issueNumber} not found`,
					retryable: false,
				}),
			);
		}
		state.comments.push({ issueNumber, body });
		return Effect.succeed({ id: 1000 + state.comments.length });
	},

	getLinkedIssues: (prNumber) => {
		const linked = state.linkedIssues.get(prNumber);
		return Effect.succeed(linked ?? []);
	},
});

/**
 * Test implementation for GitHubIssue.
 *
 * @public
 */
export const GitHubIssueTest = {
	layer: (state: GitHubIssueTestState): Layer.Layer<GitHubIssue> =>
		Layer.succeed(GitHubIssueTag, makeTestClient(state)),

	empty: (): {
		state: GitHubIssueTestState;
		layer: Layer.Layer<GitHubIssue>;
	} => {
		const state: GitHubIssueTestState = {
			issues: new Map(),
			comments: [],
			closeCalls: [],
			linkedIssues: new Map(),
		};
		return {
			state,
			layer: Layer.succeed(GitHubIssueTag, makeTestClient(state)),
		};
	},
} as const;
