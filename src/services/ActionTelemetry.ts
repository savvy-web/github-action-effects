import type { Effect } from "effect";
import { Context } from "effect";
import type { MetricData, SpanData } from "../schemas/Telemetry.js";

/**
 * Timings result returned by {@link ActionTelemetry.getTimings}.
 *
 * @public
 */
export interface Timings {
	readonly spans: Array<SpanData>;
	readonly metrics: Array<MetricData>;
}

/**
 * Service interface for lightweight timing spans and metrics.
 *
 * ActionTelemetry is a recording service — it never fails on its own.
 * The `span` method propagates the inner effect's error channel.
 *
 * @public
 */
export interface ActionTelemetry {
	/**
	 * Wrap an effect in a timing span. Records start/end time and duration.
	 * Returns the inner effect's result and propagates its error.
	 */
	readonly span: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

	/**
	 * Record a numeric metric value.
	 */
	readonly metric: (name: string, value: number, unit?: string | undefined) => Effect.Effect<void>;

	/**
	 * Set an attribute on the current span (via FiberRef).
	 */
	readonly attribute: (key: string, value: string) => Effect.Effect<void>;

	/**
	 * Retrieve all recorded spans and metrics.
	 */
	readonly getTimings: () => Effect.Effect<Timings>;
}

/**
 * ActionTelemetry tag for dependency injection.
 *
 * @public
 */
export const ActionTelemetry = Context.GenericTag<ActionTelemetry>("ActionTelemetry");
