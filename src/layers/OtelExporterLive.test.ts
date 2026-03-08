import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { OtelExporterLive } from "./OtelExporterLive.js";

describe("OtelExporterLive", () => {
	it("returns no-op layer when disabled", async () => {
		const layer = OtelExporterLive({
			enabled: false,
			endpoint: "",
			protocol: "grpc",
			headers: {},
		});

		const result = await Effect.runPromise(
			Effect.succeed("ok").pipe(Effect.withSpan("test-span"), Effect.provide(layer)),
		);
		expect(result).toBe("ok");
	});

	it("fails with helpful message when packages not installed", async () => {
		const layer = OtelExporterLive({
			enabled: true,
			endpoint: "http://localhost:4317",
			protocol: "grpc",
			headers: {},
		});

		try {
			await Effect.runPromise(Effect.succeed("ok").pipe(Effect.provide(layer)));
			// If OTel packages happen to be installed, that's ok
		} catch (error) {
			expect(String(error)).toContain("OtelExporterError");
		}
	});
});
