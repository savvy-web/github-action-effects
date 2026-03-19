import * as core from "@actions/core";
import { Layer } from "effect";
import { ActionsCore } from "../services/ActionsCore.js";

/**
 * Live implementation of {@link ActionsCore} using `@actions/core`.
 *
 * @public
 */
export const ActionsCoreLive: Layer.Layer<ActionsCore> = Layer.succeed(ActionsCore, core);
