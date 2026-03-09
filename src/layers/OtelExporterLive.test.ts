import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { OtelExporterLive } from "./OtelExporterLive.js";

describe("OtelExporterLive", () => {
	it("returns InMemoryTracer layer when disabled", async () => {
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

	it("creates layer successfully when enabled with grpc protocol", () => {
		const layer = OtelExporterLive({
			enabled: true,
			endpoint: "http://localhost:4317",
			protocol: "grpc",
			headers: {},
		});
		expect(layer).toBeDefined();
	});

	it("creates layer successfully when enabled with http/protobuf protocol", () => {
		const layer = OtelExporterLive({
			enabled: true,
			endpoint: "http://localhost:4318",
			protocol: "http/protobuf",
			headers: {},
		});
		expect(layer).toBeDefined();
	});

	it("creates layer successfully when enabled with http/json protocol", () => {
		const layer = OtelExporterLive({
			enabled: true,
			endpoint: "http://localhost:4318",
			protocol: "http/json",
			headers: {},
		});
		expect(layer).toBeDefined();
	});
});
