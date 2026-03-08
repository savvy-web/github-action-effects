import { Schema } from "effect";

/**
 * Data recorded for a single metric observation.
 *
 * @public
 */
export const MetricData = Schema.Struct({
	name: Schema.String,
	value: Schema.Number,
	unit: Schema.UndefinedOr(Schema.String),
	timestamp: Schema.Number,
}).annotations({
	identifier: "MetricData",
	title: "Metric Data",
	description: "Numeric metric recorded by ActionTelemetry",
});

export type MetricData = typeof MetricData.Type;
