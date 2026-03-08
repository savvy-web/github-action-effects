import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitTag } from "../services/GitTag.js";
import { GitTagLive } from "./GitTagLive.js";

const mockCreateRef = vi.fn();
const mockDeleteRef = vi.fn();
const mockGetRef = vi.fn();
const mockListMatchingRefs = vi.fn();

const mockClient: GitHubClient = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						git: {
							createRef: mockCreateRef,
							deleteRef: mockDeleteRef,
							getRef: mockGetRef,
							listMatchingRefs: mockListMatchingRefs,
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
							git: {
								listMatchingRefs: mockListMatchingRefs,
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
		it("lists tags via paginate and strips refs/tags/ prefix", async () => {
			mockListMatchingRefs.mockResolvedValue({
				data: [{ ref: "refs/tags/v1.0.0", object: { sha: "abc123" } }],
			});
			const result = await run(Effect.flatMap(GitTag, (svc) => svc.list("v1.")));
			expect(result).toEqual([{ tag: "v1.0.0", sha: "abc123" }]);
		});
	});

	describe("list", () => {
		it("lists tags without prefix (undefined)", async () => {
			mockListMatchingRefs.mockResolvedValue({
				data: [
					{ ref: "refs/tags/v1.0.0", object: { sha: "abc123" } },
					{ ref: "refs/tags/v2.0.0", object: { sha: "def456" } },
				],
			});
			const result = await run(Effect.flatMap(GitTag, (svc) => svc.list()));
			expect(result).toEqual([
				{ tag: "v1.0.0", sha: "abc123" },
				{ tag: "v2.0.0", sha: "def456" },
			]);
			expect(mockListMatchingRefs).toHaveBeenCalledWith(
				expect.objectContaining({
					ref: "tags/",
				}),
			);
		});

		it("maps API error to GitTagError without tag field", async () => {
			mockListMatchingRefs.mockRejectedValue(new Error("api error"));
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
		it("returns the SHA from the ref", async () => {
			mockGetRef.mockResolvedValue({
				data: { ref: "refs/tags/v1.0.0", object: { sha: "abc123" } },
			});
			const result = await run(Effect.flatMap(GitTag, (svc) => svc.resolve("v1.0.0")));
			expect(result).toBe("abc123");
		});
	});
});
