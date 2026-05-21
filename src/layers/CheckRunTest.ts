import { Effect, Layer } from "effect";
import { CheckRunError } from "../errors/CheckRunError.js";
import type { CheckRunConclusion, CheckRunData, CheckRunOutput } from "../services/CheckRun.js";
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
	readonly htmlUrl: string;
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

const recordToData = (run: CheckRunRecord): CheckRunData => ({
	id: run.id,
	name: run.name,
	status: run.status,
	conclusion: run.conclusion ?? null,
	htmlUrl: run.htmlUrl,
});

const makeTestCheckRun = (state: CheckRunTestState): typeof CheckRun.Service => {
	const impl: typeof CheckRun.Service = {
		create: (name, headSha) =>
			Effect.sync(() => {
				const id = state.nextId++;
				const run: CheckRunRecord = {
					id,
					name,
					headSha,
					htmlUrl: `https://github.com/test/checks/${id}`,
					status: "in_progress",
					outputs: [],
				};
				state.runs.push(run);
				return recordToData(run);
			}),

		get: (checkRunId) =>
			Effect.sync(() => state.runs.find((r) => r.id === checkRunId)).pipe(
				Effect.flatMap((run) =>
					run
						? Effect.succeed(recordToData(run))
						: Effect.fail(
								new CheckRunError({ name: "", operation: "get", reason: `No check run with id ${checkRunId}` }),
							),
				),
			),

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
			Effect.flatMap(impl.create(name, headSha), (checkRun) =>
				Effect.matchCauseEffect(effect(checkRun.id), {
					onFailure: (cause) => Effect.flatMap(impl.complete(checkRun.id, "failure"), () => Effect.failCause(cause)),
					onSuccess: (result) => Effect.map(impl.complete(checkRun.id, "success"), () => result),
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
