import * as github from "@actions/github";
import { Layer } from "effect";
import { ActionsGitHub } from "../services/ActionsGitHub.js";

/**
 * Live implementation of {@link ActionsGitHub} using `@actions/github`.
 *
 * @public
 */
export const ActionsGitHubLive: Layer.Layer<ActionsGitHub> = Layer.succeed(ActionsGitHub, {
	getOctokit: (token) => github.getOctokit(token),
});
