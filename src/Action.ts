import * as core from "@actions/core";
import * as PlatformNode from "@effect/platform-node";
import type { Schema } from "effect";
import { Cause, Effect, Layer } from "effect";
import type { ActionInputError } from "./errors/ActionInputError.js";
import { ActionInputsLive } from "./layers/ActionInputsLive.js";
import { ActionLoggerLayer, ActionLoggerLive, makeActionLogger, setLogLevel } from "./layers/ActionLoggerLive.js";
import { ActionOutputsLive } from "./layers/ActionOutputsLive.js";
import { ActionsCoreLive } from "./layers/ActionsCoreLive.js";
import { InMemoryTracer } from "./layers/InMemoryTracer.js";
import { OtelExporterLive } from "./layers/OtelExporterLive.js";
import type { LogLevelInput } from "./schemas/LogLevel.js";
import { resolveLogLevel } from "./schemas/LogLevel.js";
import type { OtelEnabled } from "./schemas/OtelExporter.js";
import { resolveOtelConfig } from "./schemas/OtelExporter.js";
import type { ActionInputs } from "./services/ActionInputs.js";
import { ActionInputs as ActionInputsTag } from "./services/ActionInputs.js";
import type { ActionLogger as ActionLoggerType } from "./services/ActionLogger.js";
import { ActionLogger } from "./services/ActionLogger.js";
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
export type CoreServices = ActionInputs | ActionLoggerType | ActionOutputs | PlatformNode.NodeContext.NodeContext;

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
).pipe(Layer.provide(ActionsCoreLive));

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
		// Read OTel inputs (optional, safe defaults)
		const otelEnabled = (core.getInput("otel-enabled") || "auto") as OtelEnabled;
		const otelEndpoint = core.getInput("otel-endpoint") || "";
		const otelProtocol = core.getInput("otel-protocol") || "";
		const otelHeaders = core.getInput("otel-headers") || "";

		let otelLayer: Layer.Layer<never>;
		try {
			const otelConfig = resolveOtelConfig({
				enabled: otelEnabled,
				endpoint: otelEndpoint,
				protocol: otelProtocol,
				headers: otelHeaders,
			});
			otelLayer = OtelExporterLive(otelConfig);
		} catch {
			// If resolution fails (e.g., enabled but no endpoint), fall back to in-memory
			otelLayer = InMemoryTracer.layer;
		}

		// biome-ignore lint/suspicious/noExplicitAny: Layer type erasure at the run boundary
		const fullLayer: Layer.Layer<any, never, never> = layer
			? Layer.mergeAll(CoreLive, otelLayer, layer)
			: Layer.mergeAll(CoreLive, otelLayer);

		// Only write telemetry to step summary when log level is debug
		const logLevelInput = (core.getInput("log-level") || "auto") as LogLevelInput;
		const effectiveLogLevel = resolveLogLevel(logLevelInput);

		const writeTelemetrySummary = Effect.gen(function* () {
			if (effectiveLogLevel !== "debug") return;
			const spans = yield* InMemoryTracer.getSpans();
			if (spans.length > 0) {
				const summaries = spans.map((s) => {
					const base = { name: s.name, duration: s.duration, status: s.status, attributes: s.attributes };
					return s.parentName !== undefined ? { ...base, parentName: s.parentName } : base;
				});
				yield* TelemetryReport.toSummary(summaries);
			}
		}).pipe(Effect.catchAll(() => Effect.void));

		const bufferedProgram = Effect.gen(function* () {
			const logger = yield* ActionLogger;
			yield* logger.withBuffer("action", program);
		});

		const runnable = bufferedProgram.pipe(
			Effect.onExit(() => writeTelemetrySummary),
			Effect.provide(fullLayer),
			Effect.provide(ActionLoggerLayer),
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
						core.debug(`Effect span trace:\n${spanTrace}`);
					}
				} catch {
					// pretty failed — no span trace available
				}

				const fullMessage = stack ? `Action failed: ${message}\n${stack}` : `Action failed: ${message}`;

				return Effect.sync(() => core.setFailed(fullMessage));
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
