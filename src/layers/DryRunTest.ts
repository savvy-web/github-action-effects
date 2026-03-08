import { Effect, Layer } from "effect";
import type { DryRun } from "../services/DryRun.js";
import { DryRun as DryRunTag } from "../services/DryRun.js";

/**
 * Test state for DryRun.
 *
 * @public
 */
export interface DryRunTestState {
	readonly guardedLabels: Array<string>;
}

const makeTestClient = (state: DryRunTestState): DryRun => ({
	isDryRun: Effect.succeed(true),
	guard: <A, E, R>(label: string, _effect: Effect.Effect<A, E, R>, fallback: A) => {
		state.guardedLabels.push(label);
		return Effect.succeed(fallback) as Effect.Effect<A, E, R>;
	},
});

/**
 * Test implementation for DryRun.
 *
 * @public
 */
export const DryRunTest = {
	layer: (state: DryRunTestState): Layer.Layer<DryRun> => Layer.succeed(DryRunTag, makeTestClient(state)),
	empty: (): { state: DryRunTestState; layer: Layer.Layer<DryRun> } => {
		const state: DryRunTestState = { guardedLabels: [] };
		return { state, layer: Layer.succeed(DryRunTag, makeTestClient(state)) };
	},
} as const;
