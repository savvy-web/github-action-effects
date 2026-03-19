import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

export default NodeLibraryBuilder.create({
	apiModel: {
		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
	},
	externals: [
		"@actions/cache",
		"@actions/core",
		"@actions/exec",
		"@actions/github",
		"@actions/tool-cache",
		"@effect/cluster",
		"@effect/platform",
		"@effect/platform-node",
		"@effect/rpc",
		"@effect/sql",
		"@octokit/auth-app",
		"effect",
	],
	transform({ pkg }) {
		delete pkg.devDependencies;
		delete pkg.bundleDependencies;
		delete pkg.scripts;
		delete pkg.publishConfig;
		delete pkg.packageManager;
		delete pkg.devEngines;
		return pkg;
	},
});
