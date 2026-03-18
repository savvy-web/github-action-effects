import { Effect, Layer, Option } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { PullRequestComment } from "../services/PullRequestComment.js";
import { PullRequestCommentLive } from "./PullRequestCommentLive.js";

const mockRestFn = vi.fn();

const mockClient: typeof GitHubClient.Service = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () => fn({ rest: { issues: mockRestFn() } }),
			catch: (e) =>
				new GitHubClientError({
					operation: _operation,
					status: undefined,
					reason: e instanceof Error ? e.message : String(e),
					retryable: false,
				}),
		}).pipe(Effect.map((r) => r.data)),
	graphql: () => Effect.die("not used"),
	paginate: () => Effect.die("not used"),
	repo: Effect.succeed({ owner: "test-owner", repo: "test-repo" }),
};

const testLayer = Layer.provide(PullRequestCommentLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, PullRequestComment>) =>
	Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, PullRequestComment>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("PullRequestCommentLive", () => {
	describe("create", () => {
		it("creates a comment and returns id", async () => {
			mockRestFn.mockReturnValue({
				createComment: vi.fn().mockResolvedValue({ data: { id: 42 } }),
			});
			const result = await run(Effect.flatMap(PullRequestComment, (svc) => svc.create(1, "hello")));
			expect(result).toBe(42);
		});

		it("fails on API error", async () => {
			mockRestFn.mockReturnValue({
				createComment: vi.fn().mockRejectedValue(new Error("api error")),
			});
			const exit = await runExit(Effect.flatMap(PullRequestComment, (svc) => svc.create(1, "hello")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("upsert", () => {
		it("creates new comment when no existing match", async () => {
			const issuesMock = {
				listComments: vi.fn().mockResolvedValue({ data: [] }),
				createComment: vi.fn().mockResolvedValue({ data: { id: 99 } }),
			};
			mockRestFn.mockReturnValue(issuesMock);
			const result = await run(Effect.flatMap(PullRequestComment, (svc) => svc.upsert(1, "test-key", "body")));
			expect(result).toBe(99);
		});

		it("updates existing comment when marker found", async () => {
			const issuesMock = {
				listComments: vi.fn().mockResolvedValue({
					data: [{ id: 50, body: "<!-- savvy-web:test-key -->\nold body" }],
				}),
				updateComment: vi.fn().mockResolvedValue({ data: { id: 50 } }),
			};
			mockRestFn.mockReturnValue(issuesMock);
			const result = await run(Effect.flatMap(PullRequestComment, (svc) => svc.upsert(1, "test-key", "new body")));
			expect(result).toBe(50);
		});
	});

	describe("find", () => {
		it("returns Some when comment found", async () => {
			mockRestFn.mockReturnValue({
				listComments: vi.fn().mockResolvedValue({
					data: [{ id: 10, body: "<!-- savvy-web:find-key -->\ncontent" }],
				}),
			});
			const result = await run(Effect.flatMap(PullRequestComment, (svc) => svc.find(1, "find-key")));
			expect(Option.isSome(result)).toBe(true);
		});

		it("returns None when no match", async () => {
			mockRestFn.mockReturnValue({
				listComments: vi.fn().mockResolvedValue({ data: [] }),
			});
			const result = await run(Effect.flatMap(PullRequestComment, (svc) => svc.find(1, "missing")));
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("delete", () => {
		it("deletes a comment", async () => {
			mockRestFn.mockReturnValue({
				deleteComment: vi.fn().mockResolvedValue({ data: {} }),
			});
			await run(Effect.flatMap(PullRequestComment, (svc) => svc.delete(1, 42)));
		});

		it("fails on API error", async () => {
			mockRestFn.mockReturnValue({
				deleteComment: vi.fn().mockRejectedValue(new Error("delete failed")),
			});
			const exit = await runExit(Effect.flatMap(PullRequestComment, (svc) => svc.delete(1, 42)));
			expect(exit._tag).toBe("Failure");
		});
	});
});
