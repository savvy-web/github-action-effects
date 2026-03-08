import { Data } from "effect";

/**
 * Base class for OtelExporterError.
 *
 * @internal
 */
export const OtelExporterErrorBase = Data.TaggedError("OtelExporterError");

/**
 * Error when an OpenTelemetry exporter operation fails.
 */
export class OtelExporterError extends OtelExporterErrorBase<{
	/** The operation that failed. */
	readonly operation: "resolve" | "init" | "export";

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
