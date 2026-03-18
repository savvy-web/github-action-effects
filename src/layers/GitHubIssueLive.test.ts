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

const mockClient: typeof GitHubClient.Service = {
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

	describe("list options", () => {
		it("passes labels filter when provided", async () => {
			mockListForRepo.mockResolvedValue({
				data: [{ number: 1, title: "Bug", state: "open", labels: [{ name: "bug" }] }],
			});
			await run(Effect.flatMap(GitHubIssue, (svc) => svc.list({ labels: ["bug", "critical"] })));
			expect(mockListForRepo).toHaveBeenCalledWith(
				expect.objectContaining({
					labels: "bug,critical",
					state: "open",
				}),
			);
		});

		it("omits labels when empty array", async () => {
			mockListForRepo.mockResolvedValue({ data: [] });
			await run(Effect.flatMap(GitHubIssue, (svc) => svc.list({ labels: [] })));
			const callArgs = mockListForRepo.mock.calls[0]?.[0];
			expect(callArgs).not.toHaveProperty("labels");
		});

		it("passes milestone when provided", async () => {
			mockListForRepo.mockResolvedValue({ data: [] });
			await run(Effect.flatMap(GitHubIssue, (svc) => svc.list({ milestone: 3 })));
			expect(mockListForRepo).toHaveBeenCalledWith(expect.objectContaining({ milestone: 3 }));
		});

		it("omits milestone when not provided", async () => {
			mockListForRepo.mockResolvedValue({ data: [] });
			await run(Effect.flatMap(GitHubIssue, (svc) => svc.list({ state: "closed" })));
			const callArgs = mockListForRepo.mock.calls[0]?.[0];
			expect(callArgs).not.toHaveProperty("milestone");
			expect(callArgs).toHaveProperty("state", "closed");
		});

		it("passes perPage and maxPages pagination options", async () => {
			mockListForRepo.mockResolvedValue({ data: [] });
			await run(Effect.flatMap(GitHubIssue, (svc) => svc.list({ perPage: 10, maxPages: 2 })));
			// The pagination options are passed to client.paginate, not to the REST call
			expect(mockListForRepo).toHaveBeenCalled();
		});

		it("handles label objects without name property", async () => {
			mockListForRepo.mockResolvedValue({
				data: [{ number: 1, title: "Test", state: "open", labels: [{}] }],
			});
			const result = await run(Effect.flatMap(GitHubIssue, (svc) => svc.list()));
			expect(result[0]?.labels).toEqual([""]);
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

		it("closes without reason (omits state_reason)", async () => {
			mockUpdate.mockResolvedValue({
				data: { number: 1, title: "Bug", state: "closed", labels: [] },
			});
			await run(Effect.flatMap(GitHubIssue, (svc) => svc.close(1)));
			const callArgs = mockUpdate.mock.calls[0]?.[0];
			expect(callArgs).toHaveProperty("state", "closed");
			expect(callArgs).not.toHaveProperty("state_reason");
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
