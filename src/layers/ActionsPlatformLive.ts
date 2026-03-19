import { Layer } from "effect";
import type { ActionsCache } from "../services/ActionsCache.js";
import type { ActionsCore } from "../services/ActionsCore.js";
import type { ActionsExec } from "../services/ActionsExec.js";
import type { ActionsGitHub } from "../services/ActionsGitHub.js";
import type { ActionsToolCache } from "../services/ActionsToolCache.js";
import type { OctokitAuthApp } from "../services/OctokitAuthApp.js";
import { ActionsCacheLive } from "./ActionsCacheLive.js";
import { ActionsCoreLive } from "./ActionsCoreLive.js";
import { ActionsExecLive } from "./ActionsExecLive.js";
import { ActionsGitHubLive } from "./ActionsGitHubLive.js";
import { ActionsToolCacheLive } from "./ActionsToolCacheLive.js";
import { OctokitAuthAppLive } from "./OctokitAuthAppLive.js";

/**
 * Union of all platform wrapper services.
 *
 * @public
 */
export type ActionsPlatform =
	| ActionsCore
	| ActionsGitHub
	| ActionsCache
	| ActionsExec
	| ActionsToolCache
	| OctokitAuthApp;

/**
 * Convenience layer that provides all platform wrapper services.
 *
 * @public
 */
export const ActionsPlatformLive: Layer.Layer<ActionsPlatform> = Layer.mergeAll(
	ActionsCoreLive,
	ActionsGitHubLive,
	ActionsCacheLive,
	ActionsExecLive,
	ActionsToolCacheLive,
	OctokitAuthAppLive,
);
