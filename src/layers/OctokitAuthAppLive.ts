import { createAppAuth } from "@octokit/auth-app";
import { Layer } from "effect";
import type { AppAuth } from "../services/OctokitAuthApp.js";
import { OctokitAuthApp } from "../services/OctokitAuthApp.js";

/**
 * Live implementation of {@link OctokitAuthApp} using `@octokit/auth-app`.
 *
 * @public
 */
export const OctokitAuthAppLive: Layer.Layer<OctokitAuthApp> = Layer.succeed(OctokitAuthApp, {
	createAppAuth: (options) => createAppAuth(options) as unknown as AppAuth,
});
