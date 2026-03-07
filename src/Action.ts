import { makeActionLogger, setLogLevel } from "./layers/ActionLoggerLive.js";
import { runAction } from "./runAction.js";
import { resolveLogLevel } from "./schemas/LogLevel.js";
import { parseAllInputs } from "./services/parseAllInputs.js";

/**
 * Namespace for top-level GitHub Action helpers.
 *
 * @example
 * ```ts
 * import { Action, ActionInputs, ActionLogger } from "@savvy-web/github-action-effects"
 *
 * const program = Effect.gen(function* () {
 *   const inputs = yield* ActionInputs
 *   const logger = yield* ActionLogger
 *   // ... your action logic
 * })
 *
 * Action.run(program)
 * ```
 *
 * @public
 */
export const Action = {
	/** Run a GitHub Action program with standard boilerplate handled. */
	run: runAction,

	/** Read and validate all inputs at once, with optional cross-validation. */
	parseInputs: parseAllInputs,

	/** Create an Effect Logger that routes to GitHub Actions log functions. */
	makeLogger: makeActionLogger,

	/** Set the action log level for the current scope. */
	setLogLevel,

	/** Resolve a LogLevelInput to a concrete ActionLogLevel. */
	resolveLogLevel,
} as const;
