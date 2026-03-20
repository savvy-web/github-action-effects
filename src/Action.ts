import { Cause, Effect, Layer } from "effect";
import { ActionsRuntime } from "./runtime/ActionsRuntime.js";
import * as WorkflowCommand from "./runtime/WorkflowCommand.js";
import { resolveLogLevel } from "./schemas/LogLevel.js";
import type { ActionEnvironment } from "./services/ActionEnvironment.js";
import type { ActionLogger as ActionLoggerType } from "./services/ActionLogger.js";
import { ActionLogger } from "./services/ActionLogger.js";
import type { ActionOutputs } from "./services/ActionOutputs.js";
import type { ActionState } from "./services/ActionState.js";

/** Core services provided automatically by {@link Action.run}. */
export type CoreServices = ActionLoggerType | ActionOutputs | ActionEnvironment | ActionState;

/**
 * Options for {@link Action.run}.
 *
 * @public
 */
export interface ActionRunOptions<R = never> {
	/** Additional layer to merge with the core services. */
	readonly layer?: Layer.Layer<R, never, never>;
}

/**
 * Namespace for top-level GitHub Action helpers.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Action, ActionLogger } from "@savvy-web/github-action-effects"
 *
 * const program = Effect.gen(function* () {
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
	/**
	 * Run a GitHub Action program with standard boilerplate handled.
	 *
	 * Handles:
	 * - Providing all standard Live layers via `ActionsRuntime.Default`
	 *   (ActionLogger, ActionOutputs, ActionEnvironment, ActionState,
	 *    ConfigProvider, Effect Logger)
	 * - Wrapping the program in `ActionLogger.withBuffer` for buffered output
	 * - Catching all errors and emitting `::error::` workflow commands
	 * - Running with `Effect.runPromise`
	 *
	 * Returns a Promise that resolves when the action completes. In production
	 * the return value can be ignored (fire-and-forget). In tests, await it
	 * to avoid timing issues.
	 */
	run: ((program: Effect.Effect<void, unknown, CoreServices>, options?: ActionRunOptions): Promise<void> => {
		// biome-ignore lint/suspicious/noExplicitAny: Layer type erasure at the run boundary
		const fullLayer: Layer.Layer<any, never, never> = options?.layer
			? Layer.mergeAll(ActionsRuntime.Default, options.layer)
			: ActionsRuntime.Default;

		const bufferedProgram = Effect.gen(function* () {
			const logger = yield* ActionLogger;
			yield* logger.withBuffer("action", program);
		});

		const runnable = bufferedProgram.pipe(
			Effect.provide(fullLayer),
			Effect.catchAllCause((cause) => {
				const message = Action.formatCause(cause);

				// Extract JS stack trace if available
				let stack = "";
				try {
					const squashed = Cause.squash(cause);
					if (squashed instanceof Error && squashed.stack) {
						// Remove first line (error message already in `message`)
						const lines = squashed.stack.split("\n");
						stack = lines.slice(1).join("\n");
					}
				} catch {
					// squash failed — no stack available
				}

				// Emit Effect span trace via debug (visible with RUNNER_DEBUG=1)
				try {
					const spanTrace = Cause.pretty(cause);
					if (spanTrace.trim() !== "") {
						WorkflowCommand.issue("debug", {}, `Effect span trace:\n${spanTrace}`);
					}
				} catch {
					// pretty failed — no span trace available
				}

				const fullMessage = stack ? `Action failed: ${message}\n${stack}` : `Action failed: ${message}`;

				return Effect.sync(() => {
					WorkflowCommand.issue("error", {}, fullMessage);
					process.exitCode = 1;
				});
			}),
		);

		return Effect.runPromise(runnable).catch(() => {
			// Last resort — if even the error handler fails, the process should still exit
			process.exitCode = 1;
		});
	}) as {
		<E>(program: Effect.Effect<void, E, CoreServices>): Promise<void>;
		<E>(program: Effect.Effect<void, E, CoreServices>, options: ActionRunOptions): Promise<void>;
		<E, R>(program: Effect.Effect<void, E, CoreServices | R>, options: ActionRunOptions<R>): Promise<void>;
	},

	/** Resolve a LogLevelInput to a concrete ActionLogLevel. */
	resolveLogLevel,

	/**
	 * Extract a human-readable error message from an Effect Cause.
	 *
	 * Uses a fallback chain that always produces a non-empty string:
	 * 1. Cause.squash — extracts underlying error with [Tag] prefix
	 * 2. Cause.pretty — fallback for interrupts and other causes
	 * 3. Last resort — "Unknown error" sentinel
	 *
	 * Output uses a `[Tag] message` format for consistent parseability.
	 */
	formatCause: (cause: Cause.Cause<unknown>): string => {
		// Try structured extraction first via Cause.squash
		try {
			const squashed = Cause.squash(cause);

			// TaggedError pattern: has _tag and typically reason or message
			if (
				squashed != null &&
				typeof squashed === "object" &&
				"_tag" in squashed &&
				typeof (squashed as Record<string, unknown>)._tag === "string"
			) {
				const obj = squashed as Record<string, unknown>;
				const tag = obj._tag as string;
				// Use || (not ??) so empty-string message (Data.TaggedError default) falls through to reason
				const reason = obj.message || obj.reason;
				return reason != null ? `[${tag}] ${String(reason)}` : `[${tag}]`;
			}

			// Standard Error
			if (squashed instanceof Error) {
				return `[Error] ${squashed.message}`;
			}

			// Unknown shape — JSON stringify
			const json = JSON.stringify(squashed);
			if (json && json !== "{}") {
				return `[UnknownError] ${json}`;
			}
		} catch {
			// squash or stringify failed — fall through
		}

		// Fall back to Cause.pretty
		try {
			const pretty = Cause.pretty(cause);
			if (pretty.trim() !== "") {
				return pretty;
			}
		} catch {
			// pretty failed — fall through to sentinel
		}

		return "Unknown error (no diagnostic information available)";
	},
} as const;
