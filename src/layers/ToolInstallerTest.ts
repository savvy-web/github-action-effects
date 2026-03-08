import { Effect, Layer } from "effect";
import type { ToolInstallOptions } from "../services/ToolInstaller.js";
import { ToolInstaller } from "../services/ToolInstaller.js";

/**
 * Test state for ToolInstaller.
 *
 * @public
 */
export interface ToolInstallerTestState {
	/** Records of installed tools. */
	readonly installed: Array<{ name: string; version: string; path: string }>;

	/** Set of cached tool keys (format: "name\@version"). */
	readonly cached: Set<string>;

	/** Paths that have been added to PATH. */
	readonly addedToPaths: Array<string>;
}

const cacheKey = (name: string, version: string): string => `${name}@${version}`;

const makeTestToolInstaller = (state: ToolInstallerTestState): ToolInstaller => ({
	install: (name: string, version: string, _downloadUrl: string, options?: ToolInstallOptions) => {
		const basePath = `/tools/${name}/${version}`;
		const toolPath = options?.binSubPath ? `${basePath}/${options.binSubPath}` : basePath;
		state.installed.push({ name, version, path: toolPath });
		state.cached.add(cacheKey(name, version));
		return Effect.succeed(toolPath);
	},

	isCached: (name: string, version: string) => Effect.succeed(state.cached.has(cacheKey(name, version))),

	installAndAddToPath: (name: string, version: string, _downloadUrl: string, options?: ToolInstallOptions) => {
		const basePath = `/tools/${name}/${version}`;
		const toolPath = options?.binSubPath ? `${basePath}/${options.binSubPath}` : basePath;
		state.installed.push({ name, version, path: toolPath });
		state.cached.add(cacheKey(name, version));
		state.addedToPaths.push(toolPath);
		return Effect.succeed(toolPath);
	},
});

/**
 * Test implementation for ToolInstaller.
 *
 * @public
 */
export const ToolInstallerTest = {
	/** Create test layer with pre-configured state. */
	layer: (state: ToolInstallerTestState): Layer.Layer<ToolInstaller> =>
		Layer.succeed(ToolInstaller, makeTestToolInstaller(state)),

	/** Create a fresh empty test state. */
	empty: (): ToolInstallerTestState => ({
		installed: [],
		cached: new Set(),
		addedToPaths: [],
	}),
} as const;
