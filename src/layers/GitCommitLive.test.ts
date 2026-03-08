import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitCommit } from "../services/GitCommit.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitCommitLive } from "./GitCommitLive.js";

const mockCreateTree = vi.fn();
const mockCreateCommit = vi.fn();
const mockGetRef = vi.fn();
const mockUpdateRef = vi.fn();

const mockClient: GitHubClient = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						git: {
							createTree: mockCreateTree,
							createCommit: mockCreateCommit,
							getRef: mockGetRef,
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
	paginate: () => Effect.die("not used"),
	repo: Effect.succeed({ owner: "test-owner", repo: "test-repo" }),
};

const testLayer = Layer.provide(GitCommitLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, GitCommit>) => Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, GitCommit>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("GitCommitLive", () => {
	describe("createTree", () => {
		it("calls git.createTree with correct args", async () => {
			mockCreateTree.mockResolvedValue({ data: { sha: "tree-abc" } });
			const sha = await run(
				Effect.flatMap(GitCommit, (svc) =>
					svc.createTree([{ path: "file.txt", mode: "100644", content: "hello" }], "base-sha"),
				),
			);
			expect(sha).toBe("tree-abc");
			expect(mockCreateTree).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					base_tree: "base-sha",
					tree: [{ path: "file.txt", mode: "100644", type: "blob", content: "hello" }],
				}),
			);
		});

		it("fails on API error", async () => {
			mockCreateTree.mockRejectedValue(new Error("api error"));
			const exit = await runExit(
				Effect.flatMap(GitCommit, (svc) => svc.createTree([{ path: "f", mode: "100644", content: "c" }])),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("createCommit", () => {
		it("calls git.createCommit with correct args", async () => {
			mockCreateCommit.mockResolvedValue({ data: { sha: "commit-abc" } });
			const sha = await run(Effect.flatMap(GitCommit, (svc) => svc.createCommit("msg", "tree-sha", ["parent-sha"])));
			expect(sha).toBe("commit-abc");
			expect(mockCreateCommit).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					message: "msg",
					tree: "tree-sha",
					parents: ["parent-sha"],
				}),
			);
		});

		it("fails on API error", async () => {
			mockCreateCommit.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(GitCommit, (svc) => svc.createCommit("msg", "tree", ["parent"])));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("updateRef", () => {
		it("calls git.updateRef with correct args", async () => {
			mockUpdateRef.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(GitCommit, (svc) => svc.updateRef("main", "commit-sha", true)));
			expect(mockUpdateRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "heads/main",
					sha: "commit-sha",
					force: true,
				}),
			);
		});

		it("defaults force to false", async () => {
			mockUpdateRef.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(GitCommit, (svc) => svc.updateRef("main", "sha")));
			expect(mockUpdateRef).toHaveBeenCalledWith(
				expect.objectContaining({
					force: false,
				}),
			);
		});

		it("fails on API error", async () => {
			mockUpdateRef.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(GitCommit, (svc) => svc.updateRef("main", "sha")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("commitFiles", () => {
		it("orchestrates getRef, createTree, createCommit, updateRef", async () => {
			mockGetRef.mockResolvedValue({ data: { object: { sha: "parent-sha" } } });
			mockCreateTree.mockResolvedValue({ data: { sha: "new-tree-sha" } });
			mockCreateCommit.mockResolvedValue({ data: { sha: "new-commit-sha" } });
			mockUpdateRef.mockResolvedValue({ data: {} });

			const sha = await run(
				Effect.flatMap(GitCommit, (svc) =>
					svc.commitFiles("main", "add files", [{ path: "README.md", content: "# Hello" }]),
				),
			);

			expect(sha).toBe("new-commit-sha");

			expect(mockGetRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "heads/main",
				}),
			);

			expect(mockCreateTree).toHaveBeenCalledWith(
				expect.objectContaining({
					base_tree: "parent-sha",
					tree: [{ path: "README.md", mode: "100644", type: "blob", content: "# Hello" }],
				}),
			);

			expect(mockCreateCommit).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "add files",
					tree: "new-tree-sha",
					parents: ["parent-sha"],
				}),
			);

			expect(mockUpdateRef).toHaveBeenCalledWith(
				expect.objectContaining({
					ref: "heads/main",
					sha: "new-commit-sha",
					force: false,
				}),
			);
		});

		it("fails when getRef fails", async () => {
			mockGetRef.mockRejectedValue(new Error("not found"));
			const exit = await runExit(
				Effect.flatMap(GitCommit, (svc) => svc.commitFiles("missing", "msg", [{ path: "f", content: "c" }])),
			);
			expect(exit._tag).toBe("Failure");
		});
	});
});
