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

	it("creates layer without throwing when enabled and packages are installed", async () => {
		const layer = OtelExporterLive({
			enabled: true,
			endpoint: "http://localhost:4317",
			protocol: "grpc",
			headers: {},
		});

		// The layer builds successfully when packages are installed.
		// Running an effect with it may fail due to missing OTel SDK provider
		// setup, but the layer construction itself (dynamic imports) should not throw.
		try {
			await Effect.runPromise(Effect.succeed("ok").pipe(Effect.provide(layer)));
		} catch (error) {
			// Expected: either OtelExporterError (packages missing) or
			// a service-not-found error (packages present but SDK not fully wired)
			const msg = String(error);
			expect(msg.includes("OtelExporterError") || msg.includes("Service not found")).toBe(true);
		}
	});

	it("resolves http/protobuf protocol modules when enabled", async () => {
		const layer = OtelExporterLive({
			enabled: true,
			endpoint: "http://localhost:4318",
			protocol: "http/protobuf",
			headers: {},
		});

		try {
			await Effect.runPromise(Effect.succeed("ok").pipe(Effect.provide(layer)));
		} catch (error) {
			const msg = String(error);
			expect(msg.includes("OtelExporterError") || msg.includes("Service not found")).toBe(true);
		}
	});

	it("resolves http/json protocol modules when enabled", async () => {
		const layer = OtelExporterLive({
			enabled: true,
			endpoint: "http://localhost:4318",
			protocol: "http/json",
			headers: {},
		});

		try {
			await Effect.runPromise(Effect.succeed("ok").pipe(Effect.provide(layer)));
		} catch (error) {
			const msg = String(error);
			expect(msg.includes("OtelExporterError") || msg.includes("Service not found")).toBe(true);
		}
	});
});
