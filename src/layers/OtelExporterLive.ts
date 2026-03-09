import * as EffectOtel from "@effect/opentelemetry";
import { Layer } from "effect";
import type { ResolvedOtelConfig } from "../schemas/OtelExporter.js";
import { GitHubOtelAttributes } from "../utils/GitHubOtelAttributes.js";
import { InMemoryTracer } from "./InMemoryTracer.js";

/**
 * Create the OTel exporter layer based on resolved config.
 *
 * When enabled=false, returns InMemoryTracer (no-op for external export).
 * When enabled=true, configures the \@effect/opentelemetry bridge with
 * GitHub-aware resource attributes.
 *
 * @public
 */
export const OtelExporterLive = (config: ResolvedOtelConfig): Layer.Layer<never> => {
	if (!config.enabled) {
		return InMemoryTracer.layer;
	}

	const githubAttrs = GitHubOtelAttributes.fromEnvironment();
	const attributes = { ...githubAttrs, ...config.resourceAttributes };

	return EffectOtel.Tracer.layerGlobal.pipe(
		Layer.provide(
			EffectOtel.Resource.layer({
				serviceName: config.serviceName ?? "github-action",
				serviceVersion: process.env.__PACKAGE_VERSION__ ?? "0.0.0",
				attributes,
			}),
		),
	) as Layer.Layer<never>;
};
