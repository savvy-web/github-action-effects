import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

export default NodeLibraryBuilder.create({
	externals: ["@actions/core", "@actions/exec", "@actions/github", "effect"],
	transform({ pkg }) {
		delete pkg.devDependencies;
		delete pkg.scripts;
		delete pkg.publishConfig;
		delete pkg.devEngines;
		return pkg;
	},
});
