import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubGraphQL } from "../services/GitHubGraphQL.js";
import { PullRequest } from "../services/PullRequest.js";
import { PullRequestLive } from "./PullRequestLive.js";

const mockGet = vi.fn();
const mockListFiles = vi.fn();
const mockListPRsAssociatedWithCommit = vi.fn();

const mockClient: typeof GitHubClient.Service = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						pulls: { get: mockGet },
						repos: { listPullRequestsAssociatedWithCommit: mockListPRsAssociatedWithCommit },
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
	paginate: <T>(_operation: string, fn: (octokit: unknown, page: number, perPage: number) => Promise<{ data: T[] }>) =>
		Effect.tryPromise({
			try: () =>
				fn(
					{
						rest: {
							pulls: { listFiles: mockListFiles },
						},
					},
					1,
					100,
				).then((r) => r.data),
			catch: (e) =>
				new GitHubClientError({
					operation: _operation,
					status: undefined,
					reason: e instanceof Error ? e.message : String(e),
					retryable: false,
				}),
		}),
	repo: Effect.succeed({ owner: "test-owner", repo: "test-repo" }),
};

const mockGraphQL: typeof GitHubGraphQL.Service = {
	query: () => Effect.die("not used"),
	mutation: () => Effect.die("not used"),
};

const testLayer = Layer.provide(
	PullRequestLive,
	Layer.merge(Layer.succeed(GitHubClient, mockClient), Layer.succeed(GitHubGraphQL, mockGraphQL)),
);

const run = <A, E>(effect: Effect.Effect<A, E, PullRequest>) => Effect.runPromise(Effect.provide(effect, testLayer));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("PullRequestLive", () => {
	describe("get", () => {
		it("returns PullRequestInfo from pulls.get response", async () => {
			mockGet.mockResolvedValue({
				data: {
					number: 42,
					html_url: "https://github.com/test-owner/test-repo/pull/42",
					node_id: "PR_node_42",
					title: "Test PR",
					state: "open",
					head: { ref: "feature-branch" },
					base: { ref: "main", sha: "base-sha-42" },
					draft: false,
					merged: false,
					merged_at: null,
					body: null,
					merge_commit_sha: null,
				},
			});

			const info = await run(Effect.flatMap(PullRequest, (svc) => svc.get(42)));
			expect(info.number).toBe(42);
			expect(info.url).toBe("https://github.com/test-owner/test-repo/pull/42");
			expect(info.state).toBe("open");
			expect(info.mergedAt).toBeNull();
			expect(info.mergeCommitSha).toBeNull();
		});

		it("PullRequestInfo carries mergedAt, body, and mergeCommitSha", async () => {
			mockGet.mockResolvedValue({
				data: {
					number: 7,
					html_url: "https://github.com/test-owner/test-repo/pull/7",
					node_id: "PR_node_7",
					title: "Merged PR",
					state: "closed",
					head: { ref: "feat/thing" },
					base: { ref: "main", sha: "base-sha-7" },
					draft: false,
					merged: true,
					merged_at: "2026-05-18T00:00:00Z",
					body: "the PR body",
					merge_commit_sha: "abc123",
				},
			});

			const info = await run(Effect.flatMap(PullRequest, (svc) => svc.get(7)));
			expect(info.mergedAt).toBe("2026-05-18T00:00:00Z");
			expect(info.body).toBe("the PR body");
			expect(info.mergeCommitSha).toBe("abc123");
		});

		it("get maps the base SHA to baseSha", async () => {
			mockGet.mockResolvedValue({
				data: {
					number: 7,
					html_url: "https://github.com/test-owner/test-repo/pull/7",
					node_id: "PR_node_7",
					title: "SHA PR",
					state: "open",
					head: { ref: "feat/sha-test" },
					base: { ref: "main", sha: "deadbeef1234" },
					draft: false,
					merged: false,
					merged_at: null,
					body: null,
					merge_commit_sha: null,
				},
			});

			const info = await run(Effect.flatMap(PullRequest, (svc) => svc.get(7)));
			expect(info.baseSha).toBe("deadbeef1234");
		});
	});

	describe("listFiles", () => {
		it("listFiles returns the PR's changed files", async () => {
			mockListFiles.mockResolvedValue({
				data: [
					{ filename: "src/index.ts", status: "modified" },
					{ filename: "README.md", status: "added" },
				],
			});

			const files = await run(Effect.flatMap(PullRequest, (svc) => svc.listFiles(7)));
			expect(files).toHaveLength(2);
			expect(files[0].filename).toBe("src/index.ts");
			expect(files[0].status).toBe("modified");
			expect(files[1].filename).toBe("README.md");
			expect(files[1].status).toBe("added");
		});
	});

	describe("listAssociatedWithCommit", () => {
		it("listAssociatedWithCommit returns the associated PRs", async () => {
			mockListPRsAssociatedWithCommit.mockResolvedValue({
				data: [
					{
						number: 99,
						html_url: "https://github.com/test-owner/test-repo/pull/99",
						node_id: "PR_node_99",
						title: "Associated PR",
						state: "closed",
						head: { ref: "feat/associated" },
						base: { ref: "main", sha: "base-sha-99" },
						draft: false,
						merged: true,
						merged_at: "2026-01-01T00:00:00Z",
						body: null,
						merge_commit_sha: "sha-merge-99",
					},
				],
			});

			const prs = await run(Effect.flatMap(PullRequest, (svc) => svc.listAssociatedWithCommit("sha123")));
			expect(prs).toHaveLength(1);
			expect(prs[0].number).toBe(99);
			expect(prs[0].baseSha).toBe("base-sha-99");
			expect(prs[0].mergeCommitSha).toBe("sha-merge-99");
		});
	});
});
