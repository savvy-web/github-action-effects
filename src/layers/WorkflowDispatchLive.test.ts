import { Effect, Exit, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { WorkflowDispatch } from "../services/WorkflowDispatch.js";
import { WorkflowDispatchLive } from "./WorkflowDispatchLive.js";

const mockCreateWorkflowDispatch = vi.fn();
const mockListWorkflowRuns = vi.fn();
const mockGetWorkflowRun = vi.fn();

const mockClient: GitHubClient = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						actions: {
							createWorkflowDispatch: mockCreateWorkflowDispatch,
							listWorkflowRuns: mockListWorkflowRuns,
							getWorkflowRun: mockGetWorkflowRun,
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

const testLayer = Layer.provide(WorkflowDispatchLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, WorkflowDispatch>) =>
	Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, WorkflowDispatch>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("WorkflowDispatchLive", () => {
	describe("dispatch", () => {
		it("calls actions.createWorkflowDispatch", async () => {
			mockCreateWorkflowDispatch.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(WorkflowDispatch, (svc) => svc.dispatch("deploy.yml", "main")));
			expect(mockCreateWorkflowDispatch).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					workflow_id: "deploy.yml",
					ref: "main",
				}),
			);
		});

		it("passes inputs when provided", async () => {
			mockCreateWorkflowDispatch.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(WorkflowDispatch, (svc) => svc.dispatch("deploy.yml", "main", { env: "staging" })));
			expect(mockCreateWorkflowDispatch).toHaveBeenCalledWith(
				expect.objectContaining({
					inputs: { env: "staging" },
				}),
			);
		});

		it("fails on API error", async () => {
			mockCreateWorkflowDispatch.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(WorkflowDispatch, (svc) => svc.dispatch("deploy.yml", "main")));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("getRunStatus", () => {
		it("returns status and conclusion", async () => {
			mockGetWorkflowRun.mockResolvedValue({
				data: { status: "completed", conclusion: "success" },
			});
			const result = await run(Effect.flatMap(WorkflowDispatch, (svc) => svc.getRunStatus(123)));
			expect(result).toEqual({ status: "completed", conclusion: "success" });
			expect(mockGetWorkflowRun).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					run_id: 123,
				}),
			);
		});

		it("fails on API error", async () => {
			mockGetWorkflowRun.mockRejectedValue(new Error("not found"));
			const exit = await runExit(Effect.flatMap(WorkflowDispatch, (svc) => svc.getRunStatus(999)));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("dispatchAndWait", () => {
		const futureDate = "2099-01-01T00:00:00.000Z";

		it("dispatches and returns conclusion on first poll", async () => {
			mockCreateWorkflowDispatch.mockResolvedValue({ data: {} });
			mockListWorkflowRuns.mockImplementation(() =>
				Promise.resolve({
					data: {
						workflow_runs: [
							{
								id: 1,
								status: "completed",
								conclusion: "success",
								created_at: futureDate,
							},
						],
					},
				}),
			);
			const result = await run(
				Effect.flatMap(WorkflowDispatch, (svc) =>
					svc.dispatchAndWait("deploy.yml", "main", undefined, {
						intervalMs: 1,
						timeoutMs: 1000,
					}),
				),
			);
			expect(result).toBe("success");
			expect(mockCreateWorkflowDispatch).toHaveBeenCalledTimes(1);
			expect(mockListWorkflowRuns).toHaveBeenCalledTimes(1);
		});

		it("retries until run completes", async () => {
			mockCreateWorkflowDispatch.mockResolvedValue({ data: {} });

			let callCount = 0;
			mockListWorkflowRuns.mockImplementation(() => {
				callCount++;
				if (callCount < 3) {
					return Promise.resolve({
						data: {
							workflow_runs: [
								{
									id: 1,
									status: "in_progress",
									conclusion: null,
									created_at: futureDate,
								},
							],
						},
					});
				}
				return Promise.resolve({
					data: {
						workflow_runs: [
							{
								id: 1,
								status: "completed",
								conclusion: "failure",
								created_at: futureDate,
							},
						],
					},
				});
			});

			const result = await run(
				Effect.flatMap(WorkflowDispatch, (svc) =>
					svc.dispatchAndWait("deploy.yml", "main", undefined, {
						intervalMs: 1,
						timeoutMs: 10_000,
					}),
				),
			);
			expect(result).toBe("failure");
			expect(callCount).toBeGreaterThanOrEqual(3);
		});

		it("times out when workflow never completes", async () => {
			mockCreateWorkflowDispatch.mockResolvedValue({ data: {} });
			mockListWorkflowRuns.mockImplementation(() =>
				Promise.resolve({
					data: {
						workflow_runs: [
							{
								id: 1,
								status: "in_progress",
								conclusion: null,
								created_at: futureDate,
							},
						],
					},
				}),
			);

			const exit = await runExit(
				Effect.flatMap(WorkflowDispatch, (svc) =>
					svc.dispatchAndWait("deploy.yml", "main", undefined, {
						intervalMs: 1,
						timeoutMs: 10,
					}),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});
});
