import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { CheckRun } from "../services/CheckRun.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { CheckRunLive } from "./CheckRunLive.js";

const mockCreate = vi.fn();
const mockUpdate = vi.fn();

const mockClient: typeof GitHubClient.Service = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						checks: { create: mockCreate, update: mockUpdate },
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

const testLayer = Layer.provide(CheckRunLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, CheckRun>) => Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, CheckRun>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("CheckRunLive", () => {
	describe("create", () => {
		it("calls checks.create and returns id", async () => {
			mockCreate.mockResolvedValue({ data: { id: 123 } });
			const result = await run(Effect.flatMap(CheckRun, (svc) => svc.create("my-check", "abc123")));
			expect(result).toBe(123);
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					name: "my-check",
					head_sha: "abc123",
					status: "in_progress",
				}),
			);
		});

		it("fails on API error", async () => {
			mockCreate.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(CheckRun, (svc) => svc.create("check", "sha")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("update", () => {
		it("calls checks.update with formatted output", async () => {
			mockUpdate.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(CheckRun, (svc) => svc.update(1, { title: "Test", summary: "Summary" })));
			expect(mockUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					check_run_id: 1,
					output: { title: "Test", summary: "Summary" },
				}),
			);
		});

		it("caps annotations at 50", async () => {
			mockUpdate.mockResolvedValue({ data: {} });
			const annotations = Array.from({ length: 60 }, (_, i) => ({
				path: `file${i}.ts`,
				start_line: 1,
				end_line: 1,
				annotation_level: "warning" as const,
				message: `msg${i}`,
			}));
			await run(Effect.flatMap(CheckRun, (svc) => svc.update(1, { title: "T", summary: "S", annotations })));
			const call = mockUpdate.mock.calls[0]?.[0];
			expect(call.output.annotations).toHaveLength(50);
		});
	});

	describe("complete", () => {
		it("marks check run as completed", async () => {
			mockUpdate.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(CheckRun, (svc) => svc.complete(5, "success")));
			expect(mockUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					check_run_id: 5,
					status: "completed",
					conclusion: "success",
				}),
			);
		});

		it("includes output when provided", async () => {
			mockUpdate.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(CheckRun, (svc) => svc.complete(5, "failure", { title: "Failed", summary: "Bad" })));
			expect(mockUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					output: { title: "Failed", summary: "Bad" },
				}),
			);
		});
	});

	describe("withCheckRun", () => {
		it("creates, runs effect, and completes with success", async () => {
			mockCreate.mockResolvedValue({ data: { id: 10 } });
			mockUpdate.mockResolvedValue({ data: {} });
			const result = await run(
				Effect.flatMap(CheckRun, (svc) => svc.withCheckRun("bracket-check", "sha123", (_id) => Effect.succeed("done"))),
			);
			expect(result).toBe("done");
			expect(mockCreate).toHaveBeenCalledTimes(1);
			expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ conclusion: "success" }));
		});

		it("completes with failure when effect fails", async () => {
			mockCreate.mockResolvedValue({ data: { id: 11 } });
			mockUpdate.mockResolvedValue({ data: {} });
			const exit = await runExit(
				Effect.flatMap(CheckRun, (svc) =>
					svc.withCheckRun("fail-check", "sha456", (_id) => Effect.fail(new Error("boom"))),
				),
			);
			expect(exit._tag).toBe("Failure");
			expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ conclusion: "failure" }));
		});
	});
});
