import { Effect, Layer, Ref } from "effect";
import type { MetricData } from "../schemas/Telemetry.js";
import { ActionTelemetry } from "../services/ActionTelemetry.js";

/**
 * Live implementation of the ActionTelemetry service.
 *
 * Records numeric metrics in a `Ref` array with `performance.now()` timestamps.
 * The `attribute` method delegates to `Effect.annotateCurrentSpan`, which
 * is a no-op if no span is active.
 *
 * Span tracking is handled by Effect's built-in tracing via `Effect.withSpan`
 * and captured by `InMemoryTracer`.
 *
 * @public
 */
export const ActionTelemetryLive: Layer.Layer<ActionTelemetry> = Layer.effect(
	ActionTelemetry,
	Effect.gen(function* () {
		const metricsRef = yield* Ref.make<Array<MetricData>>([]);

		return {
			metric: (name: string, value: number, unit?: string | undefined) =>
				Effect.gen(function* () {
					const timestamp = yield* Effect.sync(() => performance.now());
					yield* Ref.update(metricsRef, (m) => [...m, { name, value, unit, timestamp }]);
				}).pipe(Effect.withSpan("ActionTelemetry.metric", { attributes: { "metric.name": name } })),

			attribute: (key: string, value: string) =>
				Effect.annotateCurrentSpan(key, value).pipe(Effect.withSpan("ActionTelemetry.attribute")),

			getMetrics: () => Ref.get(metricsRef).pipe(Effect.withSpan("ActionTelemetry.getMetrics")),
		};
	}),
);
