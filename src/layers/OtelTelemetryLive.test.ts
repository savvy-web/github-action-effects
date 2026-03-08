import { Cause, Effect, Exit } from "effect";
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

	it("fails with a helpful error when @effect/opentelemetry is not installed", async () => {
		const layer = OtelTelemetryLive();
		const program = Effect.void.pipe(Effect.provide(layer));
		const exit = await Effect.runPromiseExit(program);

		expect(Exit.isFailure(exit)).toBe(true);

		if (Exit.isFailure(exit)) {
			const defect = Cause.squash(exit.cause);
			expect(defect).toBeInstanceOf(Error);
			expect((defect as Error).message).toContain("@effect/opentelemetry is required for OTel support");
			expect((defect as Error).message).toContain("pnpm add @effect/opentelemetry @opentelemetry/api");
		}
	});
});
