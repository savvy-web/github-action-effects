import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

export default NodeLibraryBuilder.create({
	externals: [
		"@actions/core",
		"@actions/exec",
		"@actions/github",
		"effect",
		"@effect/platform",
		"@effect/platform-node",
	],
	transform({ pkg }) {
		delete pkg.devDependencies;
		delete pkg.scripts;
		delete pkg.publishConfig;
		delete pkg.devEngines;
		return pkg;
	},
});
