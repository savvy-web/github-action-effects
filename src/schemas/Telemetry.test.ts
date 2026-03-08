import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { MetricData } from "./Telemetry.js";

describe("MetricData", () => {
	it("decodes valid metric data with unit", () => {
		const input = { name: "duration", value: 42.5, unit: "ms", timestamp: 1700000000 };
		const result = Schema.decodeUnknownSync(MetricData)(input);
		expect(result).toEqual(input);
	});

	it("accepts undefined unit", () => {
		const input = { name: "count", value: 10, unit: undefined, timestamp: 1700000000 };
		const result = Schema.decodeUnknownSync(MetricData)(input);
		expect(result.unit).toBeUndefined();
	});

	it("rejects non-numeric value", () => {
		expect(() =>
			Schema.decodeUnknownSync(MetricData)({
				name: "duration",
				value: "fast",
				timestamp: 1700000000,
			}),
		).toThrow();
	});
});
