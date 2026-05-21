import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitTag } from "../services/GitTag.js";
import { GitTagLive } from "./GitTagLive.js";

const mockCreateRef = vi.fn();
const mockDeleteRef = vi.fn();
const mockGetRef = vi.fn();
const mockGetTag = vi.fn();
const mockListTags = vi.fn();

const mockClient: typeof GitHubClient.Service = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						git: {
							createRef: mockCreateRef,
							deleteRef: mockDeleteRef,
							getRef: mockGetRef,
							getTag: mockGetTag,
						},
						repos: {
							listTags: mockListTags,
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
							repos: {
								listTags: mockListTags,
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

const testLayer = Layer.provide(GitTagLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, GitTag>) => Effect.runPromise(Effect.provide(effect, testLayer));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("GitTagLive", () => {
	describe("create", () => {
		it("calls git.createRef with correct args", async () => {
			mockCreateRef.mockResolvedValue({
				data: { ref: "refs/tags/v1.0.0", object: { sha: "abc123" } },
			});
			await run(Effect.flatMap(GitTag, (svc) => svc.create("v1.0.0", "abc123")));
			expect(mockCreateRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "refs/tags/v1.0.0",
					sha: "abc123",
				}),
			);
		});
	});

	describe("delete", () => {
		it("calls git.deleteRef with correct args", async () => {
			mockDeleteRef.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(GitTag, (svc) => svc.delete("v1.0.0")));
			expect(mockDeleteRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "tags/v1.0.0",
				}),
			);
		});
	});

	describe("list", () => {
		it("maps commit.sha from repos.listTags into TagRef.sha", async () => {
			mockListTags.mockResolvedValue({
				data: [
					{ name: "v1.0.0", commit: { sha: "commit-abc" } },
					{ name: "v1.1.0", commit: { sha: "commit-xyz" } },
				],
			});
			const result = await run(Effect.flatMap(GitTag, (svc) => svc.list()));
			expect(result).toEqual([
				{ tag: "v1.0.0", sha: "commit-abc" },
				{ tag: "v1.1.0", sha: "commit-xyz" },
			]);
		});

		it("lists tags without prefix (undefined)", async () => {
			mockListTags.mockResolvedValue({
				data: [
					{ name: "v1.0.0", commit: { sha: "commit-abc" } },
					{ name: "v2.0.0", commit: { sha: "commit-def" } },
				],
			});
			const result = await run(Effect.flatMap(GitTag, (svc) => svc.list()));
			expect(result).toEqual([
				{ tag: "v1.0.0", sha: "commit-abc" },
				{ tag: "v2.0.0", sha: "commit-def" },
			]);
			expect(mockListTags).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
				}),
			);
		});

		it("filters tags client-side by prefix", async () => {
			mockListTags.mockResolvedValue({
				data: [
					{ name: "v1.0.0", commit: { sha: "commit-a" } },
					{ name: "v1.2.3", commit: { sha: "commit-b" } },
					{ name: "v2.0.0", commit: { sha: "commit-c" } },
					{ name: "release-1", commit: { sha: "commit-d" } },
				],
			});
			const result = await run(Effect.flatMap(GitTag, (svc) => svc.list("v1.")));
			expect(result).toEqual([
				{ tag: "v1.0.0", sha: "commit-a" },
				{ tag: "v1.2.3", sha: "commit-b" },
			]);
		});

		it("maps API error to GitTagError without tag field", async () => {
			mockListTags.mockRejectedValue(new Error("api error"));
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitTag, (svc) => svc.list("v1.")).pipe(Effect.catchAll((error) => Effect.succeed(error))),
					testLayer,
				),
			);
			expect(result).toHaveProperty("_tag", "GitTagError");
			expect(result).toHaveProperty("operation", "list");
			expect(result).not.toHaveProperty("tag");
		});
	});

	describe("error mapping with tag parameter", () => {
		it("includes tag in error for create failures", async () => {
			mockCreateRef.mockRejectedValue(new Error("api error"));
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitTag, (svc) => svc.create("v1.0.0", "abc123")).pipe(
						Effect.catchAll((error) => Effect.succeed(error)),
					),
					testLayer,
				),
			);
			expect(result).toHaveProperty("_tag", "GitTagError");
			expect(result).toHaveProperty("operation", "create");
			expect(result).toHaveProperty("tag", "v1.0.0");
		});

		it("includes tag in error for delete failures", async () => {
			mockDeleteRef.mockRejectedValue(new Error("api error"));
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitTag, (svc) => svc.delete("v2.0.0")).pipe(Effect.catchAll((error) => Effect.succeed(error))),
					testLayer,
				),
			);
			expect(result).toHaveProperty("_tag", "GitTagError");
			expect(result).toHaveProperty("operation", "delete");
			expect(result).toHaveProperty("tag", "v2.0.0");
		});

		it("includes tag in error for resolve failures", async () => {
			mockGetRef.mockRejectedValue(new Error("not found"));
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitTag, (svc) => svc.resolve("v3.0.0")).pipe(
						Effect.catchAll((error) => Effect.succeed(error)),
					),
					testLayer,
				),
			);
			expect(result).toHaveProperty("_tag", "GitTagError");
			expect(result).toHaveProperty("operation", "resolve");
			expect(result).toHaveProperty("tag", "v3.0.0");
		});
	});

	describe("resolve", () => {
		it("returns the commit SHA for a lightweight tag without calling git.getTag", async () => {
			mockGetRef.mockResolvedValue({
				data: { ref: "refs/tags/v1.0.0", object: { sha: "commit-abc", type: "commit" } },
			});
			const result = await run(Effect.flatMap(GitTag, (svc) => svc.resolve("v1.0.0")));
			expect(result).toBe("commit-abc");
			expect(mockGetTag).not.toHaveBeenCalled();
		});

		it("dereferences an annotated tag to its commit SHA via git.getTag", async () => {
			mockGetRef.mockResolvedValue({
				data: { ref: "refs/tags/v2.0.0", object: { sha: "tag-obj-sha", type: "tag" } },
			});
			mockGetTag.mockResolvedValue({
				data: { object: { sha: "commit-def", type: "commit" } },
			});
			const result = await run(Effect.flatMap(GitTag, (svc) => svc.resolve("v2.0.0")));
			expect(result).toBe("commit-def");
			expect(mockGetTag).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					tag_sha: "tag-obj-sha",
				}),
			);
		});

		it("peels a multi-hop tag-of-a-tag chain to the commit SHA", async () => {
			mockGetRef.mockResolvedValue({
				data: { ref: "refs/tags/v3.0.0", object: { sha: "tag-obj-1", type: "tag" } },
			});
			mockGetTag
				.mockResolvedValueOnce({ data: { object: { sha: "tag-obj-2", type: "tag" } } })
				.mockResolvedValueOnce({ data: { object: { sha: "commit-final", type: "commit" } } });
			const result = await run(Effect.flatMap(GitTag, (svc) => svc.resolve("v3.0.0")));
			expect(result).toBe("commit-final");
			expect(mockGetTag).toHaveBeenCalledTimes(2);
		});

		it("maps a git.getTag failure during peel to GitTagError with the tag", async () => {
			mockGetRef.mockResolvedValue({
				data: { ref: "refs/tags/v4.0.0", object: { sha: "tag-obj-sha", type: "tag" } },
			});
			mockGetTag.mockRejectedValue(new Error("tag object not found"));
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitTag, (svc) => svc.resolve("v4.0.0")).pipe(
						Effect.catchAll((error) => Effect.succeed(error)),
					),
					testLayer,
				),
			);
			expect(result).toHaveProperty("_tag", "GitTagError");
			expect(result).toHaveProperty("operation", "resolve");
			expect(result).toHaveProperty("tag", "v4.0.0");
		});
	});
});
