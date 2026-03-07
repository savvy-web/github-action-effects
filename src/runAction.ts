import * as core from "@actions/core";
import { Cause, Effect, Layer } from "effect";
import { ActionInputsLive } from "./layers/ActionInputsLive.js";
import { ActionLoggerLayer, ActionLoggerLive } from "./layers/ActionLoggerLive.js";
import { ActionOutputsLive } from "./layers/ActionOutputsLive.js";
import type { ActionInputs } from "./services/ActionInputs.js";
import type { ActionLogger } from "./services/ActionLogger.js";
import type { ActionOutputs } from "./services/ActionOutputs.js";

/** Core services provided automatically by runAction. */
type CoreServices = ActionInputs | ActionLogger | ActionOutputs;

/**
 * Standard live layer combining all core services.
 */
const CoreLive = Layer.mergeAll(ActionInputsLive, ActionLoggerLive, ActionOutputsLive);

/**
 * Run a GitHub Action program with standard boilerplate handled.
 *
 * Handles:
 * - Providing all standard Live layers (ActionInputs, ActionLogger, ActionOutputs)
 * - Installing ActionLoggerLayer (routes Effect.log to core.info/debug)
 * - Catching all errors and calling `core.setFailed`
 * - Running with `Effect.runPromise`
 *
 * Returns a Promise that resolves when the action completes. In production
 * the return value can be ignored (fire-and-forget). In tests, await it
 * to avoid timing issues.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { runAction, ActionInputs, ActionLogger } from "@savvy-web/github-action-effects"
 *
 * const program = Effect.gen(function* () {
 *   const inputs = yield* ActionInputs
 *   const logger = yield* ActionLogger
 *   // ... your action logic
 * })
 *
 * runAction(program)
 * ```
 *
 * @public
 */
export function runAction<E>(program: Effect.Effect<void, E, CoreServices>): Promise<void>;
export function runAction<E, R>(
	program: Effect.Effect<void, E, CoreServices | R>,
	layer: Layer.Layer<R, never, never>,
): Promise<void>;
export function runAction<E, R>(
	program: Effect.Effect<void, E, CoreServices | R>,
	layer?: Layer.Layer<R, never, never>,
): Promise<void> {
	// biome-ignore lint/suspicious/noExplicitAny: Layer type erasure at the run boundary
	const fullLayer: Layer.Layer<any, never, never> = layer ? Layer.mergeAll(CoreLive, layer) : CoreLive;

	const runnable = program.pipe(
		Effect.provide(fullLayer),
		Effect.provide(ActionLoggerLayer),
		Effect.catchAllCause((cause) => {
			const message = Cause.pretty(cause);
			return Effect.sync(() => core.setFailed(`Action failed: ${message}`));
		}),
	);

	return Effect.runPromise(runnable).catch(() => {
		// Last resort — if even setFailed fails, the process should still exit
		process.exitCode = 1;
	});
}
