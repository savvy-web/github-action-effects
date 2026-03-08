import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubRelease } from "../services/GitHubRelease.js";
import { GitHubReleaseLive } from "./GitHubReleaseLive.js";

const mockCreateRelease = vi.fn();
const mockUploadReleaseAsset = vi.fn();
const mockGetReleaseByTag = vi.fn();
const mockListReleases = vi.fn();

const mockClient: GitHubClient = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						repos: {
							createRelease: mockCreateRelease,
							uploadReleaseAsset: mockUploadReleaseAsset,
							getReleaseByTag: mockGetReleaseByTag,
							listReleases: mockListReleases,
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
								createRelease: mockCreateRelease,
								uploadReleaseAsset: mockUploadReleaseAsset,
								getReleaseByTag: mockGetReleaseByTag,
								listReleases: mockListReleases,
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

const testLayer = Layer.provide(GitHubReleaseLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, GitHubRelease>) => Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, GitHubRelease>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("GitHubReleaseLive", () => {
	describe("create", () => {
		it("calls repos.createRelease and returns mapped data", async () => {
			mockCreateRelease.mockResolvedValue({
				data: {
					id: 42,
					tag_name: "v1.0.0",
					name: "Release 1.0.0",
					body: "Notes",
					draft: false,
					prerelease: false,
					upload_url: "https://uploads.github.com/releases/42/assets",
				},
			});
			const result = await run(
				Effect.flatMap(GitHubRelease, (svc) => svc.create({ tag: "v1.0.0", name: "Release 1.0.0", body: "Notes" })),
			);
			expect(result.id).toBe(42);
			expect(result.tag).toBe("v1.0.0");
			expect(result.name).toBe("Release 1.0.0");
			expect(mockCreateRelease).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					tag_name: "v1.0.0",
				}),
			);
		});

		it("fails on API error", async () => {
			mockCreateRelease.mockRejectedValue(new Error("api error"));
			const exit = await runExit(
				Effect.flatMap(GitHubRelease, (svc) => svc.create({ tag: "v1.0.0", name: "R", body: "" })),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("uploadAsset", () => {
		it("calls repos.uploadReleaseAsset and returns mapped data", async () => {
			mockUploadReleaseAsset.mockResolvedValue({
				data: {
					id: 101,
					name: "dist.tar.gz",
					browser_download_url: "https://github.com/releases/download/dist.tar.gz",
					size: 2048,
				},
			});
			const result = await run(
				Effect.flatMap(GitHubRelease, (svc) => svc.uploadAsset(42, "dist.tar.gz", "binary-data", "application/gzip")),
			);
			expect(result.id).toBe(101);
			expect(result.name).toBe("dist.tar.gz");
			expect(result.size).toBe(2048);
			expect(mockUploadReleaseAsset).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					release_id: 42,
					name: "dist.tar.gz",
				}),
			);
		});
	});

	describe("getByTag", () => {
		it("calls repos.getReleaseByTag and returns mapped data", async () => {
			mockGetReleaseByTag.mockResolvedValue({
				data: {
					id: 42,
					tag_name: "v1.0.0",
					name: "Release 1.0.0",
					body: "Notes",
					draft: false,
					prerelease: false,
					upload_url: "https://uploads.github.com/releases/42/assets",
				},
			});
			const result = await run(Effect.flatMap(GitHubRelease, (svc) => svc.getByTag("v1.0.0")));
			expect(result.tag).toBe("v1.0.0");
			expect(mockGetReleaseByTag).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					tag: "v1.0.0",
				}),
			);
		});

		it("fails on API error", async () => {
			mockGetReleaseByTag.mockRejectedValue(new Error("not found"));
			const exit = await runExit(Effect.flatMap(GitHubRelease, (svc) => svc.getByTag("v99.0.0")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("list", () => {
		it("calls repos.listReleases via paginate and returns mapped data", async () => {
			mockListReleases.mockResolvedValue({
				data: [
					{
						id: 1,
						tag_name: "v1.0.0",
						name: "R1",
						body: "",
						draft: false,
						prerelease: false,
						upload_url: "https://uploads.github.com/releases/1/assets",
					},
					{
						id: 2,
						tag_name: "v2.0.0",
						name: "R2",
						body: "",
						draft: false,
						prerelease: false,
						upload_url: "https://uploads.github.com/releases/2/assets",
					},
				],
			});
			const result = await run(Effect.flatMap(GitHubRelease, (svc) => svc.list()));
			expect(result).toHaveLength(2);
			expect(result[0]?.tag).toBe("v1.0.0");
			expect(result[1]?.tag).toBe("v2.0.0");
		});
	});
});
