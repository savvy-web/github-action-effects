import { Effect, FiberRef, Layer, LogLevel, Logger } from "effect";
import type { Scope } from "effect/Scope";
import * as WorkflowCommand from "../runtime/WorkflowCommand.js";
import { ActionLogger } from "../services/ActionLogger.js";

// -- Internal helpers --

const formatMessage = (message: unknown): string => {
	const value = Array.isArray(message) && message.length === 1 ? message[0] : message;
	return typeof value === "string" ? value : JSON.stringify(value);
};

/** Fiber-scoped buffer state shared between `withBuffer` and `group`. */
interface BufferState {
	readonly label: string;
	readonly entries: Array<string>;
}

/**
 * Holds the active buffer for the current fiber, or `null` when not buffering.
 * `withBuffer` sets it via `Effect.locally`; `group` reads it to flush on error.
 */
const activeBuffer = FiberRef.unsafeMake<BufferState | null>(null);

/** Write buffered entries to stdout, then clear them so they are not reprinted. */
const flushBuffer = (state: BufferState): void => {
	if (state.entries.length === 0) return;
	process.stdout.write(`--- Buffered output for "${state.label}" ---\n`);
	for (const entry of state.entries) {
		process.stdout.write(`${entry}\n`);
	}
	process.stdout.write(`--- End buffered output for "${state.label}" ---\n`);
	state.entries.length = 0;
};

/**
 * Live implementation of the ActionLogger service.
 *
 * Has no external dependencies — uses WorkflowCommand to write group markers
 * directly to stdout and Effect's Logger API for buffering.
 */
export const ActionLoggerLive: Layer.Layer<ActionLogger> = Layer.succeed(ActionLogger, {
	group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
		Effect.acquireUseRelease(
			Effect.sync(() => WorkflowCommand.issue("group", {}, name)),
			() =>
				effect.pipe(
					Effect.tapErrorCause(() =>
						Effect.gen(function* () {
							const state = yield* FiberRef.get(activeBuffer);
							if (state !== null) {
								flushBuffer(state);
							}
						}),
					),
				),
			() => Effect.sync(() => WorkflowCommand.issue("endgroup", {}, "")),
		) as Effect.Effect<A, E, Exclude<R, Scope>>,

	withBuffer: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const minLevel = yield* FiberRef.get(FiberRef.currentMinimumLogLevel);

			// When minimum log level is Debug or lower, pass through without buffering
			if (LogLevel.lessThanEqual(minLevel, LogLevel.Debug)) {
				return yield* effect;
			}

			// Buffer verbose/debug logs; flush to stdout on failure
			const state: BufferState = { label, entries: [] };

			const bufferingLogger = Logger.make(({ logLevel, message }) => {
				const text = formatMessage(message);
				if (LogLevel.greaterThanEqual(logLevel, LogLevel.Warning)) {
					/* v8 ignore next 2 -- error vs warning branch, both tested via withBuffer */
					const cmd = LogLevel.greaterThanEqual(logLevel, LogLevel.Error) ? "error" : "warning";
					WorkflowCommand.issue(cmd, {}, text);
				} else {
					state.entries.push(text);
				}
			});

			return yield* effect.pipe(
				Logger.withMinimumLogLevel(LogLevel.All),
				Effect.provide(Logger.replace(Logger.defaultLogger, bufferingLogger)),
				Effect.locally(activeBuffer, state),
				Effect.tapErrorCause(() => Effect.sync(() => flushBuffer(state))),
			);
		}) as Effect.Effect<A, E, Exclude<R, Scope>>,
});
