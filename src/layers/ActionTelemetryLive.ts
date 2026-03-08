import { Effect, FiberRef, Layer, Ref } from "effect";
import type { MetricData, SpanData } from "../schemas/Telemetry.js";
import { ActionTelemetry } from "../services/ActionTelemetry.js";

/**
 * Live implementation of the ActionTelemetry service.
 *
 * Uses `performance.now()` for high-resolution timing.
 * Spans and metrics are accumulated in `Ref` arrays.
 * Span nesting uses `Effect.locally` so concurrent spans
 * on different fibers don't interfere with each other.
 *
 * @public
 */
export const ActionTelemetryLive: Layer.Layer<ActionTelemetry> = Layer.scoped(
	ActionTelemetry,
	Effect.gen(function* () {
		const spansRef = yield* Ref.make<Array<SpanData>>([]);
		const metricsRef = yield* Ref.make<Array<MetricData>>([]);
		const currentSpanName = yield* FiberRef.make<string | undefined>(undefined);
		const currentAttributes = yield* FiberRef.make<Record<string, string>>({});

		return {
			span: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
				FiberRef.get(currentSpanName).pipe(
					Effect.flatMap((parentName) => {
						const body = Effect.gen(function* () {
							const startTime = yield* Effect.sync(() => performance.now());
							const exit = yield* Effect.exit(effect);
							const endTime = yield* Effect.sync(() => performance.now());
							const attributes = yield* FiberRef.get(currentAttributes);

							yield* Ref.update(spansRef, (spans) => [
								...spans,
								{
									name,
									startTime,
									endTime,
									duration: endTime - startTime,
									parentName,
									attributes,
								},
							]);

							return yield* exit;
						});

						return Effect.locally(body, currentSpanName, name).pipe((eff) =>
							Effect.locally(eff, currentAttributes, {}),
						);
					}),
				) as Effect.Effect<A, E, R>,

			metric: (name: string, value: number, unit?: string | undefined) =>
				Effect.gen(function* () {
					const timestamp = yield* Effect.sync(() => performance.now());
					yield* Ref.update(metricsRef, (metrics) => [...metrics, { name, value, unit, timestamp }]);
				}),

			attribute: (key: string, value: string) =>
				FiberRef.update(currentAttributes, (attrs) => ({ ...attrs, [key]: value })),

			getTimings: () =>
				Effect.gen(function* () {
					const spans = yield* Ref.get(spansRef);
					const metrics = yield* Ref.get(metricsRef);
					return { spans, metrics };
				}),
		};
	}),
);
