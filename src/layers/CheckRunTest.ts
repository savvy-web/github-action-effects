import { Effect, Layer } from "effect";
import type { CheckRunConclusion, CheckRunOutput } from "../services/CheckRun.js";
import { CheckRun } from "../services/CheckRun.js";

/**
 * Recorded check run for testing.
 *
 * @public
 */
export interface CheckRunRecord {
	readonly id: number;
	readonly name: string;
	readonly headSha: string;
	status: "in_progress" | "completed";
	conclusion?: CheckRunConclusion;
	readonly outputs: Array<CheckRunOutput>;
}

/**
 * Test state for CheckRun.
 *
 * @public
 */
export interface CheckRunTestState {
	readonly runs: Array<CheckRunRecord>;
	nextId: number;
}

const makeTestCheckRun = (state: CheckRunTestState): typeof CheckRun.Service => {
	const impl: typeof CheckRun.Service = {
		create: (name, headSha) =>
			Effect.sync(() => {
				const id = state.nextId++;
				state.runs.push({
					id,
					name,
					headSha,
					status: "in_progress",
					outputs: [],
				});
				return id;
			}),

		update: (checkRunId, output) =>
			Effect.sync(() => {
				const run = state.runs.find((r) => r.id === checkRunId);
				if (run) {
					run.outputs.push(output);
				}
			}),

		complete: (checkRunId, conclusion, output) =>
			Effect.sync(() => {
				const run = state.runs.find((r) => r.id === checkRunId);
				if (run) {
					run.status = "completed";
					run.conclusion = conclusion;
					if (output) {
						run.outputs.push(output);
					}
				}
			}),

		withCheckRun: (name, headSha, effect) =>
			Effect.flatMap(impl.create(name, headSha), (checkRunId) =>
				Effect.matchCauseEffect(effect(checkRunId), {
					onFailure: (cause) => Effect.flatMap(impl.complete(checkRunId, "failure"), () => Effect.failCause(cause)),
					onSuccess: (result) => Effect.map(impl.complete(checkRunId, "success"), () => result),
				}),
			),
	};
	return impl;
};

/**
 * Test implementation for CheckRun.
 *
 * @public
 */
export const CheckRunTest = {
	/** Create test layer that records check run operations. */
	layer: (state: CheckRunTestState): Layer.Layer<CheckRun> => Layer.succeed(CheckRun, makeTestCheckRun(state)),

	/** Create a fresh test state. */
	empty: (): CheckRunTestState => ({
		runs: [],
		nextId: 1,
	}),
} as const;
