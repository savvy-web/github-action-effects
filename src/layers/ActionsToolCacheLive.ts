import * as tc from "@actions/tool-cache";
import { Layer } from "effect";
import { ActionsToolCache } from "../services/ActionsToolCache.js";

/**
 * Live implementation of {@link ActionsToolCache} using `@actions/tool-cache`.
 *
 * @public
 */
export const ActionsToolCacheLive: Layer.Layer<ActionsToolCache> = Layer.succeed(ActionsToolCache, {
	find: (toolName, versionSpec) => tc.find(toolName, versionSpec),
	downloadTool: (url) => tc.downloadTool(url),
	extractTar: (file, dest, flags) => tc.extractTar(file, dest, flags),
	extractZip: (file, dest) => tc.extractZip(file, dest),
	cacheDir: (sourceDir, tool, version) => tc.cacheDir(sourceDir, tool, version),
});
