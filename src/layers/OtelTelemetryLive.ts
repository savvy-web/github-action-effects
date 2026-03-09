import * as EffectOtel from "@effect/opentelemetry";
import { Layer } from "effect";

/**
 * Configuration for the OpenTelemetry bridge layer.
 *
 * @public
 */
export interface OtelConfig {
	readonly serviceName?: string;
	readonly serviceVersion?: string;
	readonly resourceAttributes?: Record<string, string>;
}

/**
 * Create a layer that bridges Effect's Tracer to OpenTelemetry.
 * Requires `@effect/opentelemetry` and `@opentelemetry/api` as peer dependencies.
 *
 * When provided, this replaces the InMemoryTracer with an OTel-backed tracer.
 * All `Effect.withSpan` calls will export spans to the configured OTel collector.
 *
 * @example
 * ```ts
 * import { OtelTelemetryLive } from "@savvy-web/github-action-effects";
 *
 * const program = myEffect.pipe(
 *   Effect.provide(OtelTelemetryLive({ serviceName: "my-action" })),
 * );
 * ```
 *
 * @public
 */
export const OtelTelemetryLive = (config?: OtelConfig): Layer.Layer<never> =>
	EffectOtel.Tracer.layerGlobal.pipe(
		Layer.provide(
			EffectOtel.Resource.layer({
				serviceName: config?.serviceName ?? "github-action",
				serviceVersion: process.env.__PACKAGE_VERSION__ ?? "0.0.0",
			}),
		),
	) as Layer.Layer<never>;
