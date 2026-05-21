import { Effect, Layer, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubArtifactMetadataError } from "../errors/GitHubArtifactMetadataError.js";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubArtifactMetadata } from "../services/GitHubArtifactMetadata.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubArtifactMetadataLive } from "./GitHubArtifactMetadataLive.js";

const mockRequest = vi.fn();

const mockClient: typeof GitHubClient.Service = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					request: mockRequest,
				}),
			catch: (e) =>
				new GitHubClientError({
					operation: _operation,
					status: undefined,
					reason: e instanceof Error ? e.message : String(e),
					retryable: false,
					retryAfterMs: undefined,
				}),
		}).pipe(Effect.map((r) => r.data)),
	graphql: () => Effect.die("not used"),
	paginateStream: () => Stream.die("not used"),
	paginate: <T>(
		_operation: string,
		fn: (octokit: unknown, page: number, perPage: number) => Promise<{ data: T[] }>,
		_options?: { perPage?: number; maxPages?: number },
	) =>
		Effect.tryPromise({
			try: () =>
				fn(
					{
						request: mockRequest,
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
					retryAfterMs: undefined,
				}),
		}).pipe(Effect.map((r) => r.data)),
	repo: Effect.succeed({ owner: "test-owner", repo: "test-repo" }),
};

const testLayer = Layer.provide(GitHubArtifactMetadataLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, GitHubArtifactMetadata>) =>
	Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, GitHubArtifactMetadata>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("GitHubArtifactMetadataLive", () => {
	describe("createStorageRecord", () => {
		it("posts the record and returns the created ids", async () => {
			mockRequest.mockResolvedValue({
				data: {
					storage_records: [{ id: 11 }, { id: 12 }],
				},
			});

			const result = await run(
				Effect.flatMap(GitHubArtifactMetadata, (svc) =>
					svc.createStorageRecord({
						name: "pkg:npm/@scope/pkg@1.2.3",
						digest: "sha256:abc123",
						version: "1.2.3",
						registryUrl: "https://npm.pkg.github.com/",
						artifactUrl: "https://github.com/packages/npm/@scope/pkg/123",
						repo: "pkg",
					}),
				),
			);

			expect(result).toEqual([11, 12]);
			expect(mockRequest).toHaveBeenCalledWith(
				"POST /orgs/{owner}/artifacts/metadata/storage-record",
				expect.objectContaining({
					owner: "test-owner",
					registry_url: "https://npm.pkg.github.com/",
					artifact_url: "https://github.com/packages/npm/@scope/pkg/123",
				}),
			);
			// Ensure camelCase inputs are NOT passed as-is (snake_case keys required)
			expect(mockRequest).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ registryUrl: expect.anything() }),
			);
			expect(mockRequest).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ artifactUrl: expect.anything() }),
			);
		});

		it("fails with GitHubArtifactMetadataError when the request fails", async () => {
			mockRequest.mockRejectedValue(new Error("network failure"));

			const exit = await runExit(
				Effect.flatMap(GitHubArtifactMetadata, (svc) =>
					svc.createStorageRecord({
						name: "pkg:npm/@scope/pkg@1.2.3",
						digest: "sha256:abc123",
						version: "1.2.3",
						registryUrl: "https://npm.pkg.github.com/",
						artifactUrl: "https://github.com/packages/npm/@scope/pkg/123",
						repo: "pkg",
					}),
				),
			);

			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				const cause = exit.cause;
				expect(cause._tag).toBe("Fail");
				if (cause._tag === "Fail") {
					const error = cause.error;
					expect(error).toBeInstanceOf(GitHubArtifactMetadataError);
					expect((error as GitHubArtifactMetadataError).operation).toBe("createStorageRecord");
				}
			}
		});
	});
});
