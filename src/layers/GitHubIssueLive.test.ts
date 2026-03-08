import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubIssue } from "../services/GitHubIssue.js";
import type { GitHubGraphQLTestState } from "./GitHubGraphQLTest.js";
import { GitHubGraphQLTest } from "./GitHubGraphQLTest.js";
import { GitHubIssueLive } from "./GitHubIssueLive.js";

const mockListForRepo = vi.fn();
const mockUpdate = vi.fn();
const mockCreateComment = vi.fn();

const mockClient: GitHubClient = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						issues: {
							listForRepo: mockListForRepo,
							update: mockUpdate,
							createComment: mockCreateComment,
						},
					},
				}),
			catch: (e) =>
				new GitHubClientError({
					operation: _operation,
					status: undefined,
					reason: e instanceof Error ? e.message : String(e),
					retryable: false,
				}),
		}).pipe(Effect.map((r) => r.data)),
	graphql: () => Effect.die("not used"),
	paginate: <T>(
		_operation: string,
		fn: (octokit: unknown, page: number, perPage: number) => Promise<{ data: T[] }>,
		_options?: { perPage?: number; maxPages?: number },
	) =>
		Effect.tryPromise({
			try: () =>
				fn(
					{
						rest: {
							issues: {
								listForRepo: mockListForRepo,
								update: mockUpdate,
								createComment: mockCreateComment,
							},
						},
					},
					1,
					30,
				),
			catch: (e) =>
				new GitHubClientError({
					operation: _operation,
					status: undefined,
					reason: e instanceof Error ? e.message : String(e),
					retryable: false,
				}),
		}).pipe(Effect.map((r) => r.data)),
	repo: Effect.succeed({ owner: "test-owner", repo: "test-repo" }),
};

let graphqlState: GitHubGraphQLTestState;

const makeTestLayer = () => {
	const { state, layer: graphqlLayer } = GitHubGraphQLTest.empty();
	graphqlState = state;
	const clientLayer = Layer.succeed(GitHubClient, mockClient);
	return Layer.provide(GitHubIssueLive, Layer.merge(clientLayer, graphqlLayer));
};

let testLayer: Layer.Layer<GitHubIssue>;

const run = <A, E>(effect: Effect.Effect<A, E, GitHubIssue>) => Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, GitHubIssue>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

beforeEach(() => {
	vi.clearAllMocks();
	testLayer = makeTestLayer();
});

describe("GitHubIssueLive", () => {
	describe("list", () => {
		it("calls issues.listForRepo via paginate and returns mapped data", async () => {
			mockListForRepo.mockResolvedValue({
				data: [
					{ number: 1, title: "Bug", state: "open", labels: [{ name: "bug" }] },
					{ number: 2, title: "Feature", state: "open", labels: ["enhancement"] },
				],
			});
			const result = await run(Effect.flatMap(GitHubIssue, (svc) => svc.list()));
			expect(result).toHaveLength(2);
			expect(result[0]?.number).toBe(1);
			expect(result[0]?.labels).toEqual(["bug"]);
			expect(result[1]?.labels).toEqual(["enhancement"]);
		});

		it("fails on API error", async () => {
			mockListForRepo.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(GitHubIssue, (svc) => svc.list()));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("close", () => {
		it("calls issues.update with state closed", async () => {
			mockUpdate.mockResolvedValue({
				data: { number: 1, title: "Bug", state: "closed", labels: [] },
			});
			await run(Effect.flatMap(GitHubIssue, (svc) => svc.close(1, "completed")));
			expect(mockUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					issue_number: 1,
					state: "closed",
					state_reason: "completed",
				}),
			);
		});

		it("fails on API error", async () => {
			mockUpdate.mockRejectedValue(new Error("not found"));
			const exit = await runExit(Effect.flatMap(GitHubIssue, (svc) => svc.close(999)));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("comment", () => {
		it("calls issues.createComment and returns id", async () => {
			mockCreateComment.mockResolvedValue({
				data: { id: 42 },
			});
			const result = await run(Effect.flatMap(GitHubIssue, (svc) => svc.comment(1, "Hello")));
			expect(result.id).toBe(42);
			expect(mockCreateComment).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					issue_number: 1,
					body: "Hello",
				}),
			);
		});
	});

	describe("getLinkedIssues", () => {
		it("queries GraphQL for closing issues references", async () => {
			graphqlState.queryResponses.set("getLinkedIssues", {
				repository: {
					pullRequest: {
						closingIssuesReferences: {
							nodes: [
								{ number: 10, title: "Fix bug" },
								{ number: 20, title: "Add feature" },
							],
						},
					},
				},
			});
			const result = await run(Effect.flatMap(GitHubIssue, (svc) => svc.getLinkedIssues(5)));
			expect(result).toHaveLength(2);
			expect(result[0]?.number).toBe(10);
			expect(result[1]?.title).toBe("Add feature");
			expect(graphqlState.queryCalls).toHaveLength(1);
			expect(graphqlState.queryCalls[0]?.operation).toBe("getLinkedIssues");
			expect(graphqlState.queryCalls[0]?.variables).toEqual(
				expect.objectContaining({ owner: "test-owner", repo: "test-repo", prNumber: 5 }),
			);
		});

		it("fails when GraphQL returns error", async () => {
			// No response set, so it will fail
			const exit = await runExit(Effect.flatMap(GitHubIssue, (svc) => svc.getLinkedIssues(99)));
			expect(exit._tag).toBe("Failure");
		});
	});
});
