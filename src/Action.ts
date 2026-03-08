import * as core from "@actions/core";
import * as PlatformNode from "@effect/platform-node";
import type { Schema } from "effect";
import { Cause, Effect, Layer } from "effect";
import type { ActionInputError } from "./errors/ActionInputError.js";
import { ActionInputsLive } from "./layers/ActionInputsLive.js";
import { ActionLoggerLayer, ActionLoggerLive, makeActionLogger, setLogLevel } from "./layers/ActionLoggerLive.js";
import { ActionOutputsLive } from "./layers/ActionOutputsLive.js";
import { InMemoryTracer } from "./layers/InMemoryTracer.js";
import { resolveLogLevel } from "./schemas/LogLevel.js";
import type { ActionInputs } from "./services/ActionInputs.js";
import { ActionInputs as ActionInputsTag } from "./services/ActionInputs.js";
import type { ActionLogger } from "./services/ActionLogger.js";
import type { ActionOutputs } from "./services/ActionOutputs.js";
import { TelemetryReport } from "./utils/TelemetryReport.js";

/**
 * Configuration for a single input in {@link Action.parseInputs}.
 *
 * Precedence rules for how an input is read:
 * 1. `json: true` — reads as JSON string, parses and validates (always required)
 * 2. `multiline: true` — reads as newline-delimited list (always required)
 * 3. `secret: true` — reads and masks the value (always required)
 * 4. `default` is set — reads as optional, falls back to default if missing
 * 5. `required: false` — reads as optional, returns undefined if missing
 * 6. Otherwise — reads as required (default behavior)
 *
 * When `json`, `multiline`, or `secret` is set, the input is always
 * treated as required regardless of `required` or `default` values.
 *
 * @public
 */
export interface InputConfig<S extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext> {
	readonly schema: S;
	readonly required?: boolean;
	readonly default?: Schema.Schema.Type<S>;
	readonly multiline?: boolean;
	readonly secret?: boolean;
	readonly json?: boolean;
}

/** Core services provided automatically by {@link Action.run}. */
export type CoreServices = ActionInputs | ActionLogger | ActionOutputs | PlatformNode.NodeContext.NodeContext;

/**
 * Infer the output type from an input config record.
 */
export type ParsedInputs<T extends Record<string, InputConfig>> = {
	readonly [K in keyof T]: T[K] extends InputConfig<infer S> ? Schema.Schema.Type<S> : never;
};

/** Standard live layer combining all core services. */
const CoreLive = Layer.mergeAll(
	ActionInputsLive,
	ActionLoggerLive,
	ActionOutputsLive,
	PlatformNode.NodeContext.layer,
	InMemoryTracer.layer,
);

/**
 * Namespace for top-level GitHub Action helpers.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
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
	 */
	run: ((
		program: Effect.Effect<void, unknown, CoreServices>,
		layer?: Layer.Layer<never, never, never>,
	): Promise<void> => {
		// biome-ignore lint/suspicious/noExplicitAny: Layer type erasure at the run boundary
		const fullLayer: Layer.Layer<any, never, never> = layer ? Layer.mergeAll(CoreLive, layer) : CoreLive;

		const writeTelemetrySummary = Effect.gen(function* () {
			const spans = yield* InMemoryTracer.getSpans();
			if (spans.length > 0) {
				const summaries = spans.map((s) => {
					const base = { name: s.name, duration: s.duration, status: s.status, attributes: s.attributes };
					return s.parentName !== undefined ? { ...base, parentName: s.parentName } : base;
				});
				yield* TelemetryReport.toSummary(summaries);
			}
		}).pipe(Effect.catchAll(() => Effect.void));

		const runnable = program.pipe(
			Effect.onExit(() => writeTelemetrySummary),
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
	}) as {
		<E>(program: Effect.Effect<void, E, CoreServices>): Promise<void>;
		<E, R>(program: Effect.Effect<void, E, CoreServices | R>, layer: Layer.Layer<R, never, never>): Promise<void>;
	},

	/**
	 * Read and validate all inputs at once, with optional cross-validation.
	 *
	 * @example
	 * ```ts
	 * const inputs = yield* Action.parseInputs({
	 *   "app-id": { schema: Schema.NumberFromString, required: true },
	 *   "branch": { schema: Schema.String, default: "main" },
	 * })
	 * ```
	 */
	parseInputs: <T extends Record<string, InputConfig>>(
		config: T,
		crossValidate?: (parsed: ParsedInputs<T>) => Effect.Effect<ParsedInputs<T>, ActionInputError>,
	): Effect.Effect<ParsedInputs<T>, ActionInputError, ActionInputs> =>
		Effect.flatMap(ActionInputsTag, (svc) => {
			const entries = Object.entries(config);

			return Effect.forEach(entries, ([name, cfg]) => {
				const { schema, json, multiline, secret } = cfg;
				const isOptional = cfg.required === false || cfg.default !== undefined;
				let readEffect: Effect.Effect<unknown, ActionInputError>;

				if (json) {
					readEffect = svc.getJson(name, schema);
				} else if (multiline) {
					readEffect = svc.getMultiline(name, schema);
				} else if (secret) {
					readEffect = svc.getSecret(name, schema);
				} else if (isOptional) {
					readEffect = svc.getOptional(name, schema).pipe(
						Effect.map((opt) => {
							if (opt._tag === "None") {
								return cfg.default;
							}
							return opt.value;
						}),
					);
				} else {
					readEffect = svc.get(name, schema);
				}

				return Effect.map(readEffect, (value) => [name, value] as const);
			}).pipe(
				Effect.map((pairs) => Object.fromEntries(pairs) as ParsedInputs<T>),
				Effect.flatMap((parsed) => (crossValidate ? crossValidate(parsed) : Effect.succeed(parsed))),
			);
		}),

	/** Create an Effect Logger that routes to GitHub Actions log functions. */
	makeLogger: makeActionLogger,

	/** Set the action log level for the current scope. */
	setLogLevel,

	/** Resolve a LogLevelInput to a concrete ActionLogLevel. */
	resolveLogLevel,
} as const;
