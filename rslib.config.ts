import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

export default NodeLibraryBuilder.create({
	externals: [
		"@actions/cache",
		"@actions/core",
		"@actions/exec",
		"@actions/github",
		"@actions/tool-cache",
		"@effect/opentelemetry",
		"@effect/platform",
		"@effect/platform-node",
		"@octokit/auth-app",
		"@opentelemetry/api",
		"@opentelemetry/exporter-metrics-otlp-grpc",
		"@opentelemetry/exporter-metrics-otlp-http",
		"@opentelemetry/exporter-metrics-otlp-proto",
		"@opentelemetry/exporter-trace-otlp-grpc",
		"@opentelemetry/exporter-trace-otlp-http",
		"@opentelemetry/exporter-trace-otlp-proto",
		"@opentelemetry/resources",
		"@opentelemetry/sdk-metrics",
		"@opentelemetry/sdk-trace-node",
		"effect",
		"jsonc-parser",
		"semver",
		"yaml",
	],
	transform({ pkg }) {
		delete pkg.devDependencies;
		delete pkg.scripts;
		delete pkg.publishConfig;
		delete pkg.devEngines;
		return pkg;
	},
});
