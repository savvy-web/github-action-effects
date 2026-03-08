import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { WorkflowDispatchError } from "../errors/WorkflowDispatchError.js";
import { WorkflowDispatchTest } from "../layers/WorkflowDispatchTest.js";
import { WorkflowDispatch } from "./WorkflowDispatch.js";

// -- Shared provide helper --

const provide = <A, E>(
	state: ReturnType<typeof WorkflowDispatchTest.empty>,
	effect: Effect.Effect<A, E, WorkflowDispatch>,
) => Effect.provide(effect, WorkflowDispatchTest.layer(state));

const run = <A, E>(
	state: ReturnType<typeof WorkflowDispatchTest.empty>,
	effect: Effect.Effect<A, E, WorkflowDispatch>,
) => Effect.runPromise(provide(state, effect));

// -- Service method shorthands --

const dispatch = (workflow: string, ref: string, inputs?: Record<string, string>) =>
	Effect.flatMap(WorkflowDispatch, (svc) => svc.dispatch(workflow, ref, inputs));

const dispatchAndWait = (workflow: string, ref: string, inputs?: Record<string, string>) =>
	Effect.flatMap(WorkflowDispatch, (svc) => svc.dispatchAndWait(workflow, ref, inputs));

const getRunStatus = (runId: number) => Effect.flatMap(WorkflowDispatch, (svc) => svc.getRunStatus(runId));

describe("WorkflowDispatch", () => {
	describe("dispatch", () => {
		it("records the dispatch", async () => {
			const state = WorkflowDispatchTest.empty();
			await run(state, dispatch("deploy.yml", "main"));
			expect(state.dispatches).toHaveLength(1);
			expect(state.dispatches[0]).toMatchObject({
				workflow: "deploy.yml",
				ref: "main",
			});
		});

		it("records dispatch with inputs", async () => {
			const state = WorkflowDispatchTest.empty();
			await run(state, dispatch("deploy.yml", "main", { env: "staging" }));
			expect(state.dispatches[0]).toMatchObject({
				workflow: "deploy.yml",
				ref: "main",
				inputs: { env: "staging" },
			});
		});

		it("records multiple dispatches", async () => {
			const state = WorkflowDispatchTest.empty();
			await run(state, dispatch("build.yml", "main"));
			await run(state, dispatch("test.yml", "develop"));
			expect(state.dispatches).toHaveLength(2);
			expect(state.dispatches[0].workflow).toBe("build.yml");
			expect(state.dispatches[1].workflow).toBe("test.yml");
		});
	});

	describe("dispatchAndWait", () => {
		it("returns configured conclusion", async () => {
			const state = WorkflowDispatchTest.empty();
			state.waitConclusion = "success";
			const result = await run(state, dispatchAndWait("deploy.yml", "main"));
			expect(result).toBe("success");
		});

		it("records the dispatch", async () => {
			const state = WorkflowDispatchTest.empty();
			await run(state, dispatchAndWait("deploy.yml", "main", { env: "prod" }));
			expect(state.dispatches).toHaveLength(1);
			expect(state.dispatches[0]).toMatchObject({
				workflow: "deploy.yml",
				ref: "main",
				inputs: { env: "prod" },
			});
		});

		it("returns failure conclusion when configured", async () => {
			const state = WorkflowDispatchTest.empty();
			state.waitConclusion = "failure";
			const result = await run(state, dispatchAndWait("deploy.yml", "main"));
			expect(result).toBe("failure");
		});
	});

	describe("getRunStatus", () => {
		it("returns status from map", async () => {
			const state = WorkflowDispatchTest.empty();
			state.statuses.set(42, { status: "completed", conclusion: "success" });
			const result = await run(state, getRunStatus(42));
			expect(result).toEqual({ status: "completed", conclusion: "success" });
		});

		it("returns default for unknown run ID", async () => {
			const state = WorkflowDispatchTest.empty();
			const result = await run(state, getRunStatus(999));
			expect(result).toEqual({ status: "completed", conclusion: "unknown" });
		});

		it("returns in-progress status", async () => {
			const state = WorkflowDispatchTest.empty();
			state.statuses.set(7, { status: "in_progress", conclusion: null });
			const result = await run(state, getRunStatus(7));
			expect(result).toEqual({ status: "in_progress", conclusion: null });
		});
	});

	describe("WorkflowDispatchError", () => {
		it("is a tagged error with correct fields", () => {
			const error = new WorkflowDispatchError({
				workflow: "deploy.yml",
				operation: "dispatch",
				reason: "Not found",
			});
			expect(error._tag).toBe("WorkflowDispatchError");
			expect(error.workflow).toBe("deploy.yml");
			expect(error.operation).toBe("dispatch");
			expect(error.reason).toBe("Not found");
		});
	});
});
