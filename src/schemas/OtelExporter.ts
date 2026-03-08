import { Schema } from "effect";

export const OtelEnabled = Schema.Literal("enabled", "disabled", "auto");
export type OtelEnabled = typeof OtelEnabled.Type;

export const OtelProtocol = Schema.Literal("grpc", "http/protobuf", "http/json");
export type OtelProtocol = typeof OtelProtocol.Type;

export interface ResolvedOtelConfig {
	readonly enabled: boolean;
	readonly endpoint: string;
	readonly protocol: OtelProtocol;
	readonly headers: Record<string, string>;
	readonly serviceName?: string;
	readonly serviceVersion?: string;
	readonly resourceAttributes?: Record<string, string>;
}

/**
 * Parse OTLP headers from comma-separated key=value string.
 * Format: "key1=value1,key2=value2"
 */
export const parseOtelHeaders = (raw: string): Record<string, string> => {
	if (raw.trim() === "") return {};
	const result: Record<string, string> = {};
	for (const entry of raw.split(",")) {
		const eqIndex = entry.indexOf("=");
		if (eqIndex === -1) continue;
		const key = entry.slice(0, eqIndex).trim();
		const value = entry.slice(eqIndex + 1).trim();
		if (key !== "") {
			result[key] = value;
		}
	}
	return result;
};

/**
 * Resolve OTel configuration from action inputs and environment variables.
 * Priority: action inputs \> env vars \> defaults.
 */
export const resolveOtelConfig = (
	inputs: {
		readonly enabled: OtelEnabled;
		readonly endpoint: string;
		readonly protocol: string;
		readonly headers: string;
	},
	env: Record<string, string | undefined> = process.env,
): ResolvedOtelConfig => {
	const endpoint = inputs.endpoint || env.OTEL_EXPORTER_OTLP_ENDPOINT || "";
	const protocolRaw = inputs.protocol || env.OTEL_EXPORTER_OTLP_PROTOCOL || "grpc";
	const protocol = (
		["grpc", "http/protobuf", "http/json"].includes(protocolRaw) ? protocolRaw : "grpc"
	) as OtelProtocol;
	const headersRaw = inputs.headers || env.OTEL_EXPORTER_OTLP_HEADERS || "";
	const headers = parseOtelHeaders(headersRaw);

	if (inputs.enabled === "disabled") {
		return { enabled: false, endpoint: "", protocol, headers: {} };
	}

	if (inputs.enabled === "enabled") {
		if (endpoint === "") {
			throw new Error(
				"otel-enabled is 'enabled' but no endpoint was provided. Set the 'otel-endpoint' input or the OTEL_EXPORTER_OTLP_ENDPOINT environment variable.",
			);
		}
		return { enabled: true, endpoint, protocol, headers };
	}

	// auto mode: enabled if endpoint is present
	if (endpoint === "") {
		return { enabled: false, endpoint: "", protocol, headers: {} };
	}
	return { enabled: true, endpoint, protocol, headers };
};
