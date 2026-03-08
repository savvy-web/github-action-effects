import { Effect, Layer } from "effect";

/**
 * Configuration for the OpenTelemetry bridge layer.
 *
 * @public
 */
export interface OtelConfig {
	readonly serviceName?: string;
	readonly serviceVersion?: string;
}

/**
 * Minimal type for the subset of `@effect/opentelemetry` we use at runtime.
 * Defined here so we can avoid `any` and computed-key access while the
 * optional peer dependency is not installed.
 *
 * @internal
 */
interface EffectOtel {
	readonly Tracer: { readonly layer: Layer.Layer<never> };
	readonly Resource: {
		readonly layer: (config: { readonly serviceName: string; readonly serviceVersion: string }) => Layer.Layer<never>;
	};
}

/**
 * Create a layer that bridges Effect's Tracer to OpenTelemetry.
 * Requires `@effect/opentelemetry` and `@opentelemetry/api` as peer dependencies.
 *
 * When provided, this replaces the InMemoryTracer with an OTel-backed tracer.
 * All `Effect.withSpan` calls will export spans to the configured OTel collector.
 *
 * If `@effect/opentelemetry` is not installed, the layer will fail with a
 * defect containing a helpful installation message.
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
	Layer.unwrapEffect(
		Effect.tryPromise({
			try: async () => {
				const moduleName = "@effect/opentelemetry";
				const otel: EffectOtel = await import(/* @vite-ignore */ moduleName);
				return otel.Tracer.layer.pipe(
					Layer.provide(
						otel.Resource.layer({
							serviceName: config?.serviceName ?? "github-action",
							serviceVersion: config?.serviceVersion ?? "0.0.0",
						}),
					),
				);
			},
			catch: () =>
				new Error(
					"@effect/opentelemetry is required for OTel support. Install it with: pnpm add @effect/opentelemetry @opentelemetry/api",
				),
		}).pipe(Effect.orDie),
	);
