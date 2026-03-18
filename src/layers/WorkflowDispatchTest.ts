import { Effect, Layer } from "effect";
import type { WorkflowRunStatus } from "../services/WorkflowDispatch.js";
import { WorkflowDispatch } from "../services/WorkflowDispatch.js";

/**
 * Recorded dispatch for testing.
 *
 * @public
 */
export interface DispatchRecord {
	readonly workflow: string;
	readonly ref: string;
	readonly inputs: Record<string, string> | undefined;
}

/**
 * Test state for WorkflowDispatch.
 *
 * @public
 */
export interface WorkflowDispatchTestState {
	readonly dispatches: Array<DispatchRecord>;
	readonly statuses: Map<number, WorkflowRunStatus>;
	/** Conclusion to return from dispatchAndWait. Defaults to "success". */
	waitConclusion: string;
}

const makeTestWorkflowDispatch = (state: WorkflowDispatchTestState): typeof WorkflowDispatch.Service => ({
	dispatch: (workflow, ref, inputs) =>
		Effect.sync(() => {
			state.dispatches.push({ workflow, ref, inputs });
		}),

	dispatchAndWait: (workflow, ref, inputs) =>
		Effect.sync(() => {
			state.dispatches.push({ workflow, ref, inputs });
			return state.waitConclusion;
		}),

	getRunStatus: (runId) =>
		Effect.sync(() => {
			const status = state.statuses.get(runId);
			if (status === undefined) {
				return { status: "completed", conclusion: "unknown" };
			}
			return status;
		}),
});

/**
 * Test implementation for WorkflowDispatch.
 *
 * @public
 */
export const WorkflowDispatchTest = {
	/** Create test layer with provided state. */
	layer: (state: WorkflowDispatchTestState): Layer.Layer<WorkflowDispatch> =>
		Layer.succeed(WorkflowDispatch, makeTestWorkflowDispatch(state)),

	/** Create a fresh test state. */
	empty: (): WorkflowDispatchTestState => ({
		dispatches: [],
		statuses: new Map(),
		waitConclusion: "success",
	}),
} as const;
