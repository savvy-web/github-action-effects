import { Effect, Layer } from "effect";
import type { MetricData, SpanData } from "../schemas/Telemetry.js";
import { ActionTelemetry } from "../services/ActionTelemetry.js";

/**
 * In-memory state captured by the test telemetry layer.
 *
 * @public
 */
export interface ActionTelemetryTestState {
	/** Recorded timing spans. */
	readonly spans: Array<SpanData>;
	/** Recorded metrics. */
	readonly metrics: Array<MetricData>;
	/** Recorded attributes (accumulated across all spans). */
	readonly attributes: Map<string, string>;
}

/**
 * Test implementation that captures telemetry in memory.
 *
 * @example
 * ```ts
 * const state = ActionTelemetryTest.empty();
 * const layer = ActionTelemetryTest.layer(state);
 * ```
 *
 * @public
 */
export const ActionTelemetryTest = {
	/**
	 * Create a fresh empty test state container.
	 */
	empty: (): ActionTelemetryTestState => ({
		spans: [],
		metrics: [],
		attributes: new Map(),
	}),

	/**
	 * Create a test layer from the given state.
	 */
	layer: (state: ActionTelemetryTestState): Layer.Layer<ActionTelemetry> =>
		Layer.succeed(ActionTelemetry, {
			span: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
				Effect.gen(function* () {
					const exit = yield* Effect.exit(effect);
					state.spans.push({
						name,
						startTime: 0,
						endTime: 0,
						duration: 0,
						parentName: undefined,
						attributes: {},
					});
					return yield* exit;
				}) as Effect.Effect<A, E, R>,

			metric: (name: string, value: number, unit?: string | undefined) =>
				Effect.sync(() => {
					state.metrics.push({ name, value, unit, timestamp: 0 });
				}),

			attribute: (key: string, value: string) =>
				Effect.sync(() => {
					state.attributes.set(key, value);
				}),

			getTimings: () =>
				Effect.sync(() => ({
					spans: [...state.spans],
					metrics: [...state.metrics],
				})),
		}),
} as const;
