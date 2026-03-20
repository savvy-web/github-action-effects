import { Effect, Layer, Option } from "effect";
import { ToolInstaller } from "../services/ToolInstaller.js";

/**
 * Test state for ToolInstaller.
 *
 * @public
 */
export interface ToolInstallerTestState {
	/** Calls to `find`. */
	readonly findCalls: Array<{ tool: string; version: string }>;

	/** Calls to `download`. */
	readonly downloadCalls: Array<{ url: string }>;

	/** Calls to `extractTar`. */
	readonly extractTarCalls: Array<{ file: string; dest?: string; flags?: ReadonlyArray<string> }>;

	/** Calls to `extractZip`. */
	readonly extractZipCalls: Array<{ file: string; dest?: string }>;

	/** Calls to `cacheDir`. */
	readonly cacheDirCalls: Array<{ sourceDir: string; tool: string; version: string }>;

	/** Calls to `cacheFile`. */
	readonly cacheFileCalls: Array<{ sourceFile: string; targetFile: string; tool: string; version: string }>;

	/** Tools that should be found (tool version to path). */
	readonly cachedTools: Map<string, string>;
}

const cacheKey = (tool: string, version: string): string => `${tool}@${version}`;

const makeTestToolInstaller = (state: ToolInstallerTestState): typeof ToolInstaller.Service => ({
	find: (tool: string, version: string) => {
		state.findCalls.push({ tool, version });
		const cached = state.cachedTools.get(cacheKey(tool, version));
		return Effect.succeed(cached !== undefined ? Option.some(cached) : Option.none());
	},

	download: (url: string) => {
		state.downloadCalls.push({ url });
		return Effect.succeed(`/tmp/download-${url.split("/").pop()}`);
	},

	extractTar: (file: string, dest?: string, flags?: ReadonlyArray<string>) => {
		const call: { file: string; dest?: string; flags?: ReadonlyArray<string> } = { file };
		if (dest !== undefined) call.dest = dest;
		if (flags !== undefined) call.flags = flags;
		state.extractTarCalls.push(call);
		return Effect.succeed(dest ?? `/tmp/extracted-${file.split("/").pop()}`);
	},

	extractZip: (file: string, dest?: string) => {
		const call: { file: string; dest?: string } = { file };
		if (dest !== undefined) call.dest = dest;
		state.extractZipCalls.push(call);
		return Effect.succeed(dest ?? `/tmp/extracted-${file.split("/").pop()}`);
	},

	cacheDir: (sourceDir: string, tool: string, version: string) => {
		state.cacheDirCalls.push({ sourceDir, tool, version });
		const path = `/tools/${tool}/${version}`;
		state.cachedTools.set(cacheKey(tool, version), path);
		return Effect.succeed(path);
	},

	cacheFile: (sourceFile: string, targetFile: string, tool: string, version: string) => {
		state.cacheFileCalls.push({ sourceFile, targetFile, tool, version });
		const path = `/tools/${tool}/${version}`;
		state.cachedTools.set(cacheKey(tool, version), path);
		return Effect.succeed(path);
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
		findCalls: [],
		downloadCalls: [],
		extractTarCalls: [],
		extractZipCalls: [],
		cacheDirCalls: [],
		cacheFileCalls: [],
		cachedTools: new Map(),
	}),
} as const;
