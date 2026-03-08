import { Schema } from "effect";

/**
 * Data recorded for a single timing span.
 *
 * @public
 */
export const SpanData = Schema.Struct({
	name: Schema.String,
	startTime: Schema.Number,
	endTime: Schema.Number,
	duration: Schema.Number,
	parentName: Schema.UndefinedOr(Schema.String),
	attributes: Schema.Record({ key: Schema.String, value: Schema.String }),
}).annotations({
	identifier: "SpanData",
	title: "Span Data",
	description: "Timing span recorded by ActionTelemetry",
});

export type SpanData = typeof SpanData.Type;

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
