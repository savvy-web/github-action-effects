import { describe, expect, it } from "vitest";
import { parseOtelHeaders, resolveOtelConfig } from "./OtelExporter.js";

describe("parseOtelHeaders", () => {
	it("parses key=value pairs", () => {
		expect(parseOtelHeaders("Authorization=Bearer token,X-Custom=value")).toEqual({
			Authorization: "Bearer token",
			"X-Custom": "value",
		});
	});

	it("returns empty object for empty string", () => {
		expect(parseOtelHeaders("")).toEqual({});
	});

	it("trims whitespace", () => {
		expect(parseOtelHeaders(" key = value , other = data ")).toEqual({
			key: "value",
			other: "data",
		});
	});

	it("handles values with equals signs", () => {
		expect(parseOtelHeaders("key=val=ue")).toEqual({ key: "val=ue" });
	});

	it("skips entries without equals sign", () => {
		expect(parseOtelHeaders("valid=yes,invalid,also=ok")).toEqual({
			valid: "yes",
			also: "ok",
		});
	});

	it("skips entries with empty key", () => {
		expect(parseOtelHeaders("=value")).toEqual({});
	});
});

describe("resolveOtelConfig", () => {
	it("disabled mode returns enabled=false", () => {
		const result = resolveOtelConfig(
			{ enabled: "disabled", endpoint: "http://localhost:4317", protocol: "grpc", headers: "" },
			{},
		);
		expect(result.enabled).toBe(false);
	});

	it("enabled mode with endpoint returns enabled=true", () => {
		const result = resolveOtelConfig(
			{ enabled: "enabled", endpoint: "http://localhost:4317", protocol: "grpc", headers: "" },
			{},
		);
		expect(result).toEqual({
			enabled: true,
			endpoint: "http://localhost:4317",
			protocol: "grpc",
			headers: {},
		});
	});

	it("enabled mode without endpoint throws", () => {
		expect(() => resolveOtelConfig({ enabled: "enabled", endpoint: "", protocol: "grpc", headers: "" }, {})).toThrow(
			"no endpoint was provided",
		);
	});

	it("auto mode with endpoint enables", () => {
		const result = resolveOtelConfig(
			{ enabled: "auto", endpoint: "http://collector:4317", protocol: "grpc", headers: "" },
			{},
		);
		expect(result.enabled).toBe(true);
	});

	it("auto mode without endpoint disables", () => {
		const result = resolveOtelConfig({ enabled: "auto", endpoint: "", protocol: "grpc", headers: "" }, {});
		expect(result.enabled).toBe(false);
	});

	it("falls back to env vars for endpoint", () => {
		const result = resolveOtelConfig(
			{ enabled: "auto", endpoint: "", protocol: "", headers: "" },
			{ OTEL_EXPORTER_OTLP_ENDPOINT: "http://env-collector:4317" },
		);
		expect(result.enabled).toBe(true);
		expect(result.endpoint).toBe("http://env-collector:4317");
	});

	it("falls back to env vars for protocol", () => {
		const result = resolveOtelConfig(
			{ enabled: "auto", endpoint: "http://localhost:4317", protocol: "", headers: "" },
			{ OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf" },
		);
		expect(result.protocol).toBe("http/protobuf");
	});

	it("falls back to env vars for headers", () => {
		const result = resolveOtelConfig(
			{ enabled: "auto", endpoint: "http://localhost:4317", protocol: "grpc", headers: "" },
			{ OTEL_EXPORTER_OTLP_HEADERS: "Api-Key=secret123" },
		);
		expect(result.headers).toEqual({ "Api-Key": "secret123" });
	});

	it("inputs take precedence over env vars", () => {
		const result = resolveOtelConfig(
			{ enabled: "auto", endpoint: "http://input:4317", protocol: "http/json", headers: "X-Input=yes" },
			{
				OTEL_EXPORTER_OTLP_ENDPOINT: "http://env:4317",
				OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
				OTEL_EXPORTER_OTLP_HEADERS: "X-Env=no",
			},
		);
		expect(result.endpoint).toBe("http://input:4317");
		expect(result.protocol).toBe("http/json");
		expect(result.headers).toEqual({ "X-Input": "yes" });
	});

	it("defaults protocol to grpc", () => {
		const result = resolveOtelConfig(
			{ enabled: "auto", endpoint: "http://localhost:4317", protocol: "", headers: "" },
			{},
		);
		expect(result.protocol).toBe("grpc");
	});
});
