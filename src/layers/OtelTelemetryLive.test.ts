import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { OtelTelemetryLive } from "./OtelTelemetryLive.js";

describe("OtelTelemetryLive", () => {
	it("can be imported without errors", () => {
		expect(OtelTelemetryLive).toBeDefined();
		expect(typeof OtelTelemetryLive).toBe("function");
	});

	it("returns a Layer when called with no config", () => {
		const layer = OtelTelemetryLive();
		expect(layer).toBeDefined();
	});

	it("returns a Layer when called with config", () => {
		const layer = OtelTelemetryLive({ serviceName: "test-action", serviceVersion: "1.0.0" });
		expect(layer).toBeDefined();
	});

	it("succeeds with global tracer provider", async () => {
		const layer = OtelTelemetryLive();
		const result = await Effect.runPromise(
			Effect.succeed("ok").pipe(Effect.withSpan("test-span"), Effect.provide(layer)),
		);
		expect(result).toBe("ok");
	});
});
