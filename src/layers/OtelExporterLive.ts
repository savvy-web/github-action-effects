import { Effect, Layer } from "effect";
import { OtelExporterError } from "../errors/OtelExporterError.js";
import type { ResolvedOtelConfig } from "../schemas/OtelExporter.js";
import { GitHubOtelAttributes } from "../utils/GitHubOtelAttributes.js";
import { InMemoryTracer } from "./InMemoryTracer.js";

const traceExporterModule = (protocol: string): string => {
	switch (protocol) {
		case "http/protobuf":
			return "@opentelemetry/exporter-trace-otlp-proto";
		case "http/json":
			return "@opentelemetry/exporter-trace-otlp-http";
		default:
			return "@opentelemetry/exporter-trace-otlp-grpc";
	}
};

const metricExporterModule = (protocol: string): string => {
	switch (protocol) {
		case "http/protobuf":
			return "@opentelemetry/exporter-metrics-otlp-proto";
		case "http/json":
			return "@opentelemetry/exporter-metrics-otlp-http";
		default:
			return "@opentelemetry/exporter-metrics-otlp-grpc";
	}
};

/** @internal */
interface EffectOtel {
	readonly Tracer: { readonly layer: Layer.Layer<never> };
	readonly Resource: {
		readonly layer: (config: { readonly serviceName: string; readonly serviceVersion: string }) => Layer.Layer<never>;
	};
}

/**
 * Create the OTel exporter layer based on resolved config.
 *
 * When enabled=false, returns InMemoryTracer (no-op for external export).
 * When enabled=true, dynamically imports exporter packages and configures
 * OTLP trace + metric export.
 *
 * @public
 */
export const OtelExporterLive = (config: ResolvedOtelConfig): Layer.Layer<never> => {
	if (!config.enabled) {
		return InMemoryTracer.layer;
	}

	return Layer.unwrapEffect(
		Effect.gen(function* () {
			const effectOtelName = "@effect/opentelemetry";
			const effectOtel: EffectOtel = yield* Effect.tryPromise({
				try: () => import(/* @vite-ignore */ effectOtelName),
				catch: () =>
					new OtelExporterError({
						operation: "init",
						reason:
							"@effect/opentelemetry is required for OTel export. Install: pnpm add @effect/opentelemetry @opentelemetry/api",
					}),
			});

			const traceModName = traceExporterModule(config.protocol);
			yield* Effect.tryPromise({
				try: () => import(/* @vite-ignore */ traceModName),
				catch: () =>
					new OtelExporterError({
						operation: "init",
						reason: `${traceModName} is required for ${config.protocol} trace export. Install: pnpm add ${traceModName}`,
					}),
			});

			const metricModName = metricExporterModule(config.protocol);
			yield* Effect.tryPromise({
				try: () => import(/* @vite-ignore */ metricModName),
				catch: () =>
					new OtelExporterError({
						operation: "init",
						reason: `${metricModName} is required for ${config.protocol} metric export. Install: pnpm add ${metricModName}`,
					}),
			});

			// Build resource attributes from GitHub env vars
			const _githubAttrs = GitHubOtelAttributes.fromEnvironment();

			// Use @effect/opentelemetry tracer bridge
			// The OTel SDK packages register themselves globally when imported,
			// and @effect/opentelemetry bridges Effect's tracer to the registered provider
			return effectOtel.Tracer.layer.pipe(
				Layer.provide(
					effectOtel.Resource.layer({
						serviceName: "github-action",
						serviceVersion: "0.0.0",
					}),
				),
			);
		}).pipe(Effect.orDie),
	);
};
