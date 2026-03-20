import { Effect, FiberRef, Layer, LogLevel, Logger } from "effect";
import type { Scope } from "effect/Scope";
import * as WorkflowCommand from "../runtime/WorkflowCommand.js";
import { ActionLogger } from "../services/ActionLogger.js";

// -- Internal helpers --

const formatMessage = (message: unknown): string => {
	const value = Array.isArray(message) && message.length === 1 ? message[0] : message;
	return typeof value === "string" ? value : JSON.stringify(value);
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
			() => effect,
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
			const buffer: Array<string> = [];

			const bufferingLogger = Logger.make(({ logLevel, message }) => {
				const text = formatMessage(message);
				if (LogLevel.greaterThanEqual(logLevel, LogLevel.Warning)) {
					// Warnings and errors pass through immediately with workflow command formatting
					const cmd = LogLevel.greaterThanEqual(logLevel, LogLevel.Error) ? "error" : "warning";
					WorkflowCommand.issue(cmd, {}, text);
				} else {
					buffer.push(text);
				}
			});

			return yield* effect.pipe(
				Logger.withMinimumLogLevel(LogLevel.All),
				Effect.provide(Logger.replace(Logger.defaultLogger, bufferingLogger)),
				Effect.tapErrorCause(() =>
					Effect.sync(() => {
						if (buffer.length > 0) {
							process.stdout.write(`--- Buffered output for "${label}" ---\n`);
							for (const entry of buffer) {
								process.stdout.write(`${entry}\n`);
							}
							process.stdout.write(`--- End buffered output for "${label}" ---\n`);
						}
					}),
				),
			);
		}) as Effect.Effect<A, E, Exclude<R, Scope>>,
});
