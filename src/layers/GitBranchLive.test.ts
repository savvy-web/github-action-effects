import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitBranch } from "../services/GitBranch.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitBranchLive } from "./GitBranchLive.js";

const mockCreateRef = vi.fn();
const mockGetRef = vi.fn();
const mockDeleteRef = vi.fn();
const mockUpdateRef = vi.fn();

const mockClient: GitHubClient = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						git: {
							createRef: mockCreateRef,
							getRef: mockGetRef,
							deleteRef: mockDeleteRef,
							updateRef: mockUpdateRef,
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
	repo: Effect.succeed({ owner: "test-owner", repo: "test-repo" }),
};

const testLayer = Layer.provide(GitBranchLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, GitBranch>) => Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, GitBranch>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("GitBranchLive", () => {
	describe("create", () => {
		it("calls git.createRef with correct args", async () => {
			mockCreateRef.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(GitBranch, (svc) => svc.create("feature/new", "abc123")));
			expect(mockCreateRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "refs/heads/feature/new",
					sha: "abc123",
				}),
			);
		});

		it("fails on API error", async () => {
			mockCreateRef.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(GitBranch, (svc) => svc.create("branch", "sha")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("exists", () => {
		it("returns true when ref exists", async () => {
			mockGetRef.mockResolvedValue({ data: { object: { sha: "abc" } } });
			const result = await run(Effect.flatMap(GitBranch, (svc) => svc.exists("main")));
			expect(result).toBe(true);
			expect(mockGetRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "heads/main",
				}),
			);
		});

		it("returns false on 404", async () => {
			mockGetRef.mockRejectedValue(new Error("Not Found"));
			const mockClientWith404: GitHubClient = {
				...mockClient,
				rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
					Effect.tryPromise({
						try: () =>
							fn({
								rest: {
									git: {
										createRef: mockCreateRef,
										getRef: mockGetRef,
										deleteRef: mockDeleteRef,
										updateRef: mockUpdateRef,
									},
								},
							}),
						catch: () =>
							new GitHubClientError({
								operation: _operation,
								status: 404,
								reason: "Not Found",
								retryable: false,
							}),
					}).pipe(Effect.map((r) => r.data)),
			};
			const layer404 = Layer.provide(GitBranchLive, Layer.succeed(GitHubClient, mockClientWith404));
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitBranch, (svc) => svc.exists("missing")),
					layer404,
				),
			);
			expect(result).toBe(false);
		});
	});

	describe("delete", () => {
		it("calls git.deleteRef with correct args", async () => {
			mockDeleteRef.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(GitBranch, (svc) => svc.delete("feature/old")));
			expect(mockDeleteRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "heads/feature/old",
				}),
			);
		});
	});

	describe("getSha", () => {
		it("returns the SHA from the ref", async () => {
			mockGetRef.mockResolvedValue({ data: { object: { sha: "def456" } } });
			const result = await run(Effect.flatMap(GitBranch, (svc) => svc.getSha("main")));
			expect(result).toBe("def456");
		});

		it("fails on API error", async () => {
			mockGetRef.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(GitBranch, (svc) => svc.getSha("missing")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("reset", () => {
		it("calls git.updateRef with force: true", async () => {
			mockUpdateRef.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(GitBranch, (svc) => svc.reset("main", "new-sha")));
			expect(mockUpdateRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "heads/main",
					sha: "new-sha",
					force: true,
				}),
			);
		});

		it("fails on API error", async () => {
			mockUpdateRef.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(GitBranch, (svc) => svc.reset("branch", "sha")));
			expect(exit._tag).toBe("Failure");
		});
	});
});
