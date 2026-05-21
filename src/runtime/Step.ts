import { Cause, Effect, Exit, FiberRef, HashSet } from "effect";
import { ActionLogger } from "../services/ActionLogger.js";
import type { BufferedLine, StepBuffer, StepFrame } from "./StepRuntime.js";
import { StepStack, emitFailure, emitSuccess, indent, makeStepBufferingLogger } from "./StepRuntime.js";

/**
 * Step-buffered logging primitives.
 *
 * Wrap an Effect in {@link withStep} to:
 *
 *   1. Open a fresh debug buffer scoped to that step.
 *   2. Run the wrapped Effect with debug/info logs captured (not
 *      printed live).
 *   3. On success — emit ONE info-level summary line and discard
 *      the buffer.
 *   4. On failure — emit a `❌ <name>` header, spill the buffered
 *      lines indented under it, then propagate the original error
 *      untouched.
 *
 * Warnings and errors are pass-through inside `withStep` because
 * they map to GitHub Actions annotations whose UI affordances would
 * be lost if buffered.
 *
 * For the design, see `docs/superpowers/specs/2026-05-20-step-buffered-logging-design.md`.
 *
 * @public
 */

/**
 * Options for {@link withStep}.
 *
 * @public
 */
export interface WithStepOptions<A> {
	/**
	 * Default summary builder. Called with the step's result if the step
	 * body never explicitly set a summary via {@link success}. Useful
	 * for steps whose info line is always the same shape (e.g.
	 * `"✅ <name>"` by default).
	 */
	readonly defaultSummary?: (result: A) => string;
}

/**
 * Render the error message for the failure block. Pulls the first
 * failure from the cause if present; falls back to the prettified
 * cause for defects.
 */
const renderErrorMessage = (cause: Cause.Cause<unknown>): string => {
	const failure = Cause.failureOption(cause);
	if (failure._tag === "Some") {
		const value: unknown = failure.value;
		if (value instanceof Error) return value.message;
		if (typeof value === "string") return value;
		if (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") {
			return value.message;
		}
		return String(value);
	}
	return Cause.pretty(cause);
};

/**
 * Compute the success summary for a step.
 *
 * Returns the outcome string the caller wants RIGHT of the
 * library-managed `✅ <name>: ` prefix. Resolution order:
 *
 *   1. The explicit `frame.successLine` if the step body called
 *      `Step.success`.
 *   2. `options.defaultSummary(result)` if the caller passed one.
 *   3. `null` — emit only the bare `✅ <name>` line.
 *
 * The icon and step name are always added by
 * {@link "./StepRuntime.js".emitSuccess}; this function never
 * returns either of them itself.
 */
const resolveSummary = <A>(frame: StepFrame, result: A, options?: WithStepOptions<A>): string | null => {
	if (frame.successLine !== null) return frame.successLine;
	if (options?.defaultSummary !== undefined) return options.defaultSummary(result);
	return null;
};

/**
 * Wrap an Effect in the step lifecycle.
 *
 * On success, emits exactly one info-level summary line:
 * `"<indent>✅ <name>: <line>"` when the body called
 * {@link success} (or `options.defaultSummary` returned a string),
 * or the bare `"<indent>✅ <name>"` when neither is set. The debug
 * buffer is discarded.
 *
 * On failure, emits `"<indent>❌ <name>: <error message>"`, spills the
 * debug buffer indented under the failure header, then propagates the
 * original error untouched. The buffered lines retain their
 * chronological order.
 *
 * If the body called {@link failure} (rather than failing the effect),
 * the step renders the same `❌` block — header plus buffer spill — but
 * returns its value instead of propagating a cause. See {@link failure}.
 *
 * The library is the single source of truth for the `✅` / `❌`
 * icon and the `<name>:` prefix. Consumers pass ONLY the outcome
 * to {@link success}.
 *
 * Nested `withStep` calls track depth automatically via the
 * fiber-local step stack. The outermost step is depth 0; each child
 * indents by two spaces.
 *
 * @public
 */
export const withStep = <A, E, R>(
	name: string,
	effect: Effect.Effect<A, E, R>,
	options?: WithStepOptions<A>,
): Effect.Effect<A, E, R> =>
	Effect.gen(function* () {
		const stack = yield* FiberRef.get(StepStack);
		const buffer: StepBuffer = { entries: [] };
		const frame: StepFrame = {
			name,
			depth: stack.length,
			successLine: null,
			failureLine: null,
			buffer,
		};

		// Install the step's buffering logger as the sole logger for
		// this scope. Using `FiberRef.locallyWith(currentLoggers, ...)`
		// (rather than `Logger.replace(Logger.defaultLogger, ...)`)
		// guarantees that pre-installed loggers (e.g. `ActionsLogger`
		// in `ActionsRuntime.Default`) don't fire alongside us and
		// double-print buffered debug lines. The HashSet is restored
		// automatically when the inner scope exits.
		const buffered = effect.pipe(
			Effect.locally(FiberRef.currentLoggers, HashSet.make(makeStepBufferingLogger(buffer))),
			Effect.locally(StepStack, [...stack, frame]),
		);

		const exit = yield* Effect.exit(buffered);

		if (Exit.isFailure(exit)) {
			emitFailure(frame, renderErrorMessage(exit.cause));
			return yield* Effect.failCause(exit.cause);
		}

		// A non-throwing failure: the body resolved with a value but called
		// `Step.failure`, so render the `❌` block (and spill) instead of the
		// success line, then return the value untouched.
		if (frame.failureLine !== null) {
			emitFailure(frame, frame.failureLine);
			return exit.value;
		}

		const summary = resolveSummary(frame, exit.value, options);
		emitSuccess(frame, summary);
		return exit.value;
	});

/**
 * Set the success summary line for the current step. Calling outside
 * a {@link withStep} envelope is a no-op (with a defensive debug log).
 *
 * @example
 * ```ts
 * Step.withStep("pack dist/npm", Effect.gen(function* () {
 *   const result = yield* publishSvc.pack(directory)
 *   yield* Step.success(`pack ${result.name}@${result.version}: ${humanizeBytes(result.packedSize)}`)
 *   return result
 * }))
 * ```
 *
 * @public
 */
export const success = (line: string): Effect.Effect<void> =>
	Effect.gen(function* () {
		const stack = yield* FiberRef.get(StepStack);
		if (stack.length === 0) {
			yield* Effect.logDebug("Step.success called outside a withStep envelope; ignoring.");
			return;
		}
		// Mutate the innermost frame. `StepFrame` is intentionally
		// mutable on `successLine` so the body can record its
		// outcome without re-threading state through the Effect.
		const innermost = stack[stack.length - 1];
		if (innermost !== undefined) {
			innermost.successLine = line;
		}
	});

/**
 * Mark the current step as failed without throwing. The step's
 * {@link withStep} envelope renders `❌ <name>: <line>` (with the usual
 * buffer spill) instead of the success line, but the wrapped effect
 * still resolves with its value so the surrounding loop can continue and
 * aggregate the outcome.
 *
 * Use this for non-fatal target failures the orchestrator records as
 * results and reports later — e.g. one registry rejecting a publish
 * while siblings succeed. For failures that should abort the fiber, fail
 * the effect instead; {@link withStep} renders the same `❌` block and
 * propagates the cause.
 *
 * Calling outside a {@link withStep} envelope is a no-op (with a
 * defensive debug log). When both `failure` and {@link success} are
 * called on the same step, `failure` wins.
 *
 * @example
 * ```ts
 * Step.withStep(`publish ${name} → ${registry}`, Effect.gen(function* () {
 *   const outcome = yield* publishSvc.publishTarball(tarball, opts).pipe(
 *     Effect.map(() => ({ ok: true as const })),
 *     Effect.catchAll((e) => Effect.succeed({ ok: false as const, error: e.message })),
 *   )
 *   if (!outcome.ok) {
 *     yield* Step.failure("publish-failed")
 *     return { status: "failed" as const, error: outcome.error }
 *   }
 *   yield* Step.success("published")
 *   return { status: "published" as const }
 * }))
 * ```
 *
 * @public
 */
export const failure = (line: string): Effect.Effect<void> =>
	Effect.gen(function* () {
		const stack = yield* FiberRef.get(StepStack);
		if (stack.length === 0) {
			yield* Effect.logDebug("Step.failure called outside a withStep envelope; ignoring.");
			return;
		}
		const innermost = stack[stack.length - 1];
		if (innermost !== undefined) {
			innermost.failureLine = line;
		}
	});

/**
 * One entry in the {@link collapse} input list.
 *
 * @public
 */
export interface CollapseStep<A> {
	readonly name: string;
	readonly effect: Effect.Effect<A, unknown>;
}

/**
 * The shape passed to the {@link collapse} reducer.
 *
 * @public
 */
export interface CollapseResult<A> {
	readonly name: string;
	readonly result: A;
}

/**
 * Run N steps in parallel.
 *
 * On all-success, the reducer is called with `{ name, result }`
 * pairs in input order; if it returns a string, that single info
 * line is emitted **instead of** N per-step lines. If the reducer
 * returns `null`, the collapse is abandoned and each child step
 * emits its own line as if it had been wrapped in `withStep`
 * directly.
 *
 * On any child failure, the collapse is also abandoned — each child
 * emits its own success line or failure block. The first child
 * failure's cause is then propagated.
 *
 * Concurrency is unbounded — the spec is for parallel registry
 * probes / attestations where the N is small (typically 2-4).
 *
 * @public
 */
export const collapse = <A>(
	steps: ReadonlyArray<CollapseStep<A>>,
	reducer: (results: ReadonlyArray<CollapseResult<A>>) => string | null,
): Effect.Effect<ReadonlyArray<A>, unknown> =>
	Effect.gen(function* () {
		const parentStack = yield* FiberRef.get(StepStack);
		const depth = parentStack.length;

		interface ChildOutcome {
			readonly frame: StepFrame;
			readonly exit: Exit.Exit<A, unknown>;
		}

		// Run all children in parallel. Each child owns its own buffer
		// and frame; the result is captured *without* emitting the
		// per-child success/failure block, so the outer collapse can
		// decide whether to substitute one collapsed line.
		const outcomes = yield* Effect.all(
			steps.map(
				(step): Effect.Effect<ChildOutcome> =>
					Effect.gen(function* () {
						const buffer: StepBuffer = { entries: [] };
						const frame: StepFrame = {
							name: step.name,
							depth,
							successLine: null,
							failureLine: null,
							buffer,
						};
						const exit = yield* Effect.exit(
							step.effect.pipe(
								Effect.locally(FiberRef.currentLoggers, HashSet.make(makeStepBufferingLogger(buffer))),
								Effect.locally(StepStack, [...parentStack, frame]),
							),
						);
						return { frame, exit };
					}),
			),
			{ concurrency: "unbounded" },
		);

		// Decide between collapsed-line and per-child emission. A child that
		// marked itself failed via `Step.failure` resolved with a value, so its
		// Exit is a success — but it must not be collapsed away, so exclude it.
		const allSucceeded = outcomes.every((o) => Exit.isSuccess(o.exit) && o.frame.failureLine === null);
		const collapsedLine = allSucceeded
			? reducer(
					outcomes.map(
						(o): CollapseResult<A> => ({
							name: o.frame.name,
							// Safe: `allSucceeded` is true.
							result: (o.exit as Exit.Success<A, unknown>).value,
						}),
					),
				)
			: null;

		if (collapsedLine !== null) {
			// One info line, at the parent's depth. Use indent for
			// alignment with whatever group/step is wrapping us.
			process.stdout.write(`${indent(depth)}${collapsedLine}\n`);
			return outcomes.map((o) => (o.exit as Exit.Success<A, unknown>).value);
		}

		// Abandoned collapse: emit each child's own line, in input
		// order. Failures emit their full spill block.
		for (const outcome of outcomes) {
			if (Exit.isFailure(outcome.exit)) {
				emitFailure(outcome.frame, renderErrorMessage(outcome.exit.cause));
			} else if (outcome.frame.failureLine !== null) {
				emitFailure(outcome.frame, outcome.frame.failureLine);
			} else {
				const summary = resolveSummary(outcome.frame, outcome.exit.value);
				emitSuccess(outcome.frame, summary);
			}
		}

		// If any child failed, propagate the first failure's cause.
		const firstFailure = outcomes.find((o): o is ChildOutcome & { exit: Exit.Failure<A, unknown> } =>
			Exit.isFailure(o.exit),
		);
		if (firstFailure !== undefined) {
			return yield* Effect.failCause(firstFailure.exit.cause);
		}

		return outcomes.map((o) => (o.exit as Exit.Success<A, unknown>).value);
	});

/**
 * Wrap an Effect in both {@link "../services/ActionLogger.js".ActionLogger.group}
 * AND {@link withStep}. The natural choice for a phase's outer scope
 * (Phase 1, Phase 2, Phase 3): a collapsible GitHub Actions block
 * containing a step-summary at the end.
 *
 * @public
 */
export const groupStep = <A, E, R>(
	name: string,
	effect: Effect.Effect<A, E, R>,
	options?: WithStepOptions<A>,
): Effect.Effect<A, E, R | ActionLogger> =>
	Effect.gen(function* () {
		const logger = yield* ActionLogger;
		return yield* logger.group(name, withStep(name, effect, options));
	});

/**
 * Re-export the buffered-line shape for consumers that want to
 * inspect the buffer in tests.
 *
 * @public
 */
export type { BufferedLine };
