import { NodeFileSystem } from "@effect/platform-node";
import { Layer, Logger } from "effect";
import { ActionEnvironmentLive } from "../layers/ActionEnvironmentLive.js";
import { ActionLoggerLive } from "../layers/ActionLoggerLive.js";
import { ActionOutputsLive } from "../layers/ActionOutputsLive.js";
import { ActionStateLive } from "../layers/ActionStateLive.js";
import { ActionsConfigProvider } from "./ActionsConfigProvider.js";
import { ActionsLogger } from "./ActionsLogger.js";

/**
 * A single convenience layer that wires all core services together for a
 * GitHub Actions environment.
 *
 * Provides:
 * - `ConfigProvider` backed by GitHub Actions `INPUT_*` environment variables
 * - `Logger` that emits GitHub Actions workflow commands (`::debug::`, `::warning::`, etc.)
 * - `ActionOutputs` for setting outputs and writing step summaries
 * - `ActionState` for reading and writing action state across phases
 * - `ActionLogger` for group markers and buffered logging
 * - `ActionEnvironment` for reading GitHub/runner context variables
 * - `FileSystem` (Node.js) required by `ActionOutputs` and `ActionState`
 *
 * @example
 * ```ts
 * import { Effect, Config } from "effect"
 * import { ActionsRuntime } from "@savvy-web/github-action-effects"
 *
 * const program = Effect.gen(function* () {
 *   const name = yield* Config.string("name")
 *   yield* Effect.log(`Hello, ${name}!`)
 * })
 *
 * Effect.runPromise(Effect.provide(program, ActionsRuntime.Default))
 * ```
 *
 * @public
 */
export const ActionsRuntime = {
	Default: Layer.mergeAll(
		Layer.setConfigProvider(ActionsConfigProvider),
		Logger.replace(Logger.defaultLogger, ActionsLogger),
		ActionEnvironmentLive,
		ActionLoggerLive,
		ActionOutputsLive,
		ActionStateLive,
	).pipe(Layer.provideMerge(NodeFileSystem.layer)),
} as const;
