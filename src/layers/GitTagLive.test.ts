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
