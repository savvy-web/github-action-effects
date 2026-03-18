import type { Effect } from "effect";
import { Context } from "effect";
import type { MetricData } from "../schemas/Telemetry.js";

/**
 * Service for recording numeric metrics.
 *
 * ActionTelemetry is a recording service — it never fails on its own.
 * Span tracking is handled by Effect's built-in tracing via `Effect.withSpan`.
 *
 * @public
 */
export class ActionTelemetry extends Context.Tag("github-action-effects/ActionTelemetry")<
	ActionTelemetry,
	{
		/**
		 * Record a numeric metric value.
		 */
		readonly metric: (name: string, value: number, unit?: string | undefined) => Effect.Effect<void>;

		/**
		 * Annotate the current span with a key-value attribute.
		 * Delegates to `Effect.annotateCurrentSpan` in the live layer.
		 * In the test layer, records to the test state's attributes map.
		 */
		readonly attribute: (key: string, value: string) => Effect.Effect<void>;

		/**
		 * Retrieve all recorded metrics.
		 */
		readonly getMetrics: () => Effect.Effect<Array<MetricData>>;
	}
>() {}
