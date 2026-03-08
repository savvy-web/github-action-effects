import { Effect, Layer } from "effect";
import type { MetricData } from "../schemas/Telemetry.js";
import { ActionTelemetry } from "../services/ActionTelemetry.js";

/**
 * In-memory state captured by the test telemetry layer.
 *
 * @public
 */
export interface ActionTelemetryTestState {
	/** Recorded metrics. */
	readonly metrics: Array<MetricData>;
	/** Recorded attributes (accumulated across all calls). */
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
		metrics: [],
		attributes: new Map(),
	}),

	/**
	 * Create a test layer from the given state.
	 */
	layer: (state: ActionTelemetryTestState): Layer.Layer<ActionTelemetry> =>
		Layer.succeed(ActionTelemetry, {
			metric: (name: string, value: number, unit?: string | undefined) =>
				Effect.sync(() => {
					state.metrics.push({ name, value, unit, timestamp: 0 });
				}),

			attribute: (key: string, value: string) =>
				Effect.sync(() => {
					state.attributes.set(key, value);
				}),

			getMetrics: () => Effect.sync(() => [...state.metrics]),
		}),
} as const;
