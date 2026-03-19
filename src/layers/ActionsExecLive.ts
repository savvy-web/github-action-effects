import * as actionsExec from "@actions/exec";
import { Layer } from "effect";
import { ActionsExec } from "../services/ActionsExec.js";

/**
 * Live implementation of {@link ActionsExec} using `@actions/exec`.
 *
 * @public
 */
export const ActionsExecLive: Layer.Layer<ActionsExec> = Layer.succeed(ActionsExec, {
	exec: (commandLine, args, options) => actionsExec.exec(commandLine, args, options),
});
