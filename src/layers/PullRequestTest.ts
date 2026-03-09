import { Effect, Layer } from "effect";
import { PullRequestError } from "../errors/PullRequestError.js";
import type { PullRequestInfo } from "../services/PullRequest.js";
import { PullRequest } from "../services/PullRequest.js";

/**
 * Recorded pull request for testing.
 *
 * @public
 */
export interface PullRequestRecord extends PullRequestInfo {
	readonly labels: Array<string>;
	readonly reviewers: Array<string>;
	readonly teamReviewers: Array<string>;
	autoMerge: "merge" | "squash" | "rebase" | false | undefined;
	body: string;
}

/**
 * Test state for PullRequest.
 *
 * @public
 */
export interface PullRequestTestState {
	readonly prs: Array<PullRequestRecord>;
	readonly mergedPrs: Array<number>;
	nextNumber: number;
}

const findPr = (state: PullRequestTestState, number: number): PullRequestRecord | undefined =>
	state.prs.find((pr) => pr.number === number);

const toInfo = (record: PullRequestRecord): PullRequestInfo => ({
	number: record.number,
	url: record.url,
	nodeId: record.nodeId,
	title: record.title,
	state: record.state,
	head: record.head,
	base: record.base,
	draft: record.draft,
	merged: record.merged,
});

const makeTestPullRequest = (state: PullRequestTestState): PullRequest => ({
	get: (number) =>
		Effect.sync(() => findPr(state, number)).pipe(
			Effect.flatMap((pr) =>
				pr
					? Effect.succeed(toInfo(pr))
					: Effect.fail(new PullRequestError({ operation: "get", prNumber: number, reason: "PR not found" })),
			),
		),

	list: (options) =>
		Effect.sync(() => {
			let results = [...state.prs];
			const filterState = options?.state ?? "open";
			if (filterState !== "all") {
				results = results.filter((pr) => pr.state === filterState);
			}
			if (options?.head) {
				const head = options.head.includes(":") ? options.head.split(":")[1] : options.head;
				results = results.filter((pr) => pr.head === head);
			}
			if (options?.base) {
				results = results.filter((pr) => pr.base === options.base);
			}
			return results.map(toInfo);
		}),

	create: (options) =>
		Effect.sync(() => {
			const number = state.nextNumber++;
			const record: PullRequestRecord = {
				number,
				url: `https://github.com/test/repo/pull/${number}`,
				nodeId: `PR_node_${number}`,
				title: options.title,
				state: "open",
				head: options.head,
				base: options.base,
				draft: options.draft ?? false,
				merged: false,
				labels: [],
				reviewers: [],
				teamReviewers: [],
				autoMerge: options.autoMerge,
				body: options.body,
			};
			state.prs.push(record);
			return toInfo(record);
		}),

	update: (number, options) =>
		Effect.sync(() => findPr(state, number)).pipe(
			Effect.flatMap((pr) => {
				if (!pr) {
					return Effect.fail(new PullRequestError({ operation: "update", prNumber: number, reason: "PR not found" }));
				}
				if (options.title !== undefined) {
					(pr as { title: string }).title = options.title;
				}
				if (options.body !== undefined) {
					pr.body = options.body;
				}
				if (options.state !== undefined) {
					(pr as { state: string }).state = options.state;
				}
				if (options.autoMerge !== undefined) {
					pr.autoMerge = options.autoMerge;
				}
				return Effect.succeed(toInfo(pr));
			}),
		),

	getOrCreate: (options) =>
		Effect.sync(() => {
			const head = options.head.includes(":") ? options.head.split(":")[1] : options.head;
			return state.prs.find((pr) => pr.head === head && pr.base === options.base && pr.state === "open");
		}).pipe(
			Effect.flatMap((existing): Effect.Effect<PullRequestInfo & { readonly created: boolean }> => {
				if (existing) {
					if (options.title !== undefined) {
						(existing as { title: string }).title = options.title;
					}
					existing.body = options.body;
					if (options.autoMerge !== undefined) {
						existing.autoMerge = options.autoMerge;
					}
					return Effect.succeed({ ...toInfo(existing), created: false as const });
				}
				const number = state.nextNumber++;
				const record: PullRequestRecord = {
					number,
					url: `https://github.com/test/repo/pull/${number}`,
					nodeId: `PR_node_${number}`,
					title: options.title,
					state: "open",
					head: options.head,
					base: options.base,
					draft: options.draft ?? false,
					merged: false,
					labels: [],
					reviewers: [],
					teamReviewers: [],
					autoMerge: options.autoMerge,
					body: options.body,
				};
				state.prs.push(record);
				return Effect.succeed({ ...toInfo(record), created: true as const });
			}),
		),

	merge: (number) =>
		Effect.sync(() => findPr(state, number)).pipe(
			Effect.flatMap((pr) => {
				if (!pr) {
					return Effect.fail(new PullRequestError({ operation: "merge", prNumber: number, reason: "PR not found" }));
				}
				(pr as { merged: boolean }).merged = true;
				(pr as { state: string }).state = "closed";
				state.mergedPrs.push(number);
				return Effect.void;
			}),
		),

	addLabels: (number, labels) =>
		Effect.sync(() => findPr(state, number)).pipe(
			Effect.flatMap((pr) => {
				if (!pr) {
					return Effect.fail(
						new PullRequestError({ operation: "addLabels", prNumber: number, reason: "PR not found" }),
					);
				}
				pr.labels.push(...labels);
				return Effect.void;
			}),
		),

	requestReviewers: (number, options) =>
		Effect.sync(() => findPr(state, number)).pipe(
			Effect.flatMap((pr) => {
				if (!pr) {
					return Effect.fail(
						new PullRequestError({
							operation: "requestReviewers",
							prNumber: number,
							reason: "PR not found",
						}),
					);
				}
				if (options.reviewers) {
					pr.reviewers.push(...options.reviewers);
				}
				if (options.teamReviewers) {
					pr.teamReviewers.push(...options.teamReviewers);
				}
				return Effect.void;
			}),
		),
});

/**
 * Test implementation for PullRequest.
 *
 * @public
 */
export const PullRequestTest = {
	/** Create test layer that records pull request operations. */
	layer: (state: PullRequestTestState): Layer.Layer<PullRequest> =>
		Layer.succeed(PullRequest, makeTestPullRequest(state)),

	/** Create a fresh test state. */
	empty: (): PullRequestTestState => ({
		prs: [],
		mergedPrs: [],
		nextNumber: 1,
	}),
} as const;
