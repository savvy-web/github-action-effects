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
		"effect",
	],
	transform({ pkg }) {
		delete pkg.devDependencies;
		delete pkg.scripts;
		delete pkg.publishConfig;
		delete pkg.devEngines;
		return pkg;
	},
});
