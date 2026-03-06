import * as core from "@actions/core";
import { Effect, FiberRef, FiberRefs, Layer, LogLevel, Logger } from "effect";
import type { Scope } from "effect/Scope";
import type { ActionLogLevel } from "../schemas/LogLevel.js";
import { ActionLogger } from "../services/ActionLogger.js";

/**
 * FiberRef that holds the current action log level for the fiber.
 */
export const CurrentLogLevel: FiberRef.FiberRef<ActionLogLevel> = FiberRef.unsafeMake("info" as ActionLogLevel);

/**
 * Set the action log level for the current scope.
 */
export const setLogLevel = (level: ActionLogLevel): Effect.Effect<void> => FiberRef.set(CurrentLogLevel, level);

// -- Internal helpers --

const formatMessage = (message: unknown): string => {
	const value = Array.isArray(message) && message.length === 1 ? message[0] : message;
	return typeof value === "string" ? value : JSON.stringify(value);
};

const shouldEmitUserFacing = (effectLevel: LogLevel.LogLevel, actionLevel: ActionLogLevel): boolean => {
	if (actionLevel === "debug") {
		return true;
	}
	if (actionLevel === "verbose") {
		return LogLevel.greaterThanEqual(effectLevel, LogLevel.Info);
	}
	return LogLevel.greaterThanEqual(effectLevel, LogLevel.Warning);
};

const emitToGitHub = (level: LogLevel.LogLevel, message: string): void => {
	if (LogLevel.greaterThanEqual(level, LogLevel.Error)) {
		core.error(message);
	} else if (LogLevel.greaterThanEqual(level, LogLevel.Warning)) {
		core.warning(message);
	} else {
		core.info(message);
	}
};

/**
 * Create an Effect Logger that routes to GitHub Actions log functions.
 *
 * - Always writes to `core.debug()` (GitHub-gated shadow channel).
 * - Writes to user-facing output based on the action log level.
 */
export const makeActionLogger = (): Logger.Logger<unknown, void> =>
	Logger.make(({ logLevel, message, context }) => {
		const text = formatMessage(message);

		// Always write to GitHub's debug channel (gated by ACTIONS_STEP_DEBUG)
		core.debug(text);

		const actionLevel = FiberRefs.getOrDefault(context, CurrentLogLevel);

		if (shouldEmitUserFacing(logLevel, actionLevel)) {
			emitToGitHub(logLevel, text);
		}
	});

/**
 * Layer that installs the GitHub Actions logger as the default Effect logger.
 */
export const ActionLoggerLayer: Layer.Layer<never> = Logger.replace(Logger.defaultLogger, makeActionLogger());

// -- Buffer implementation --

interface LogBuffer {
	entries: Array<string>;
}

const createBuffer = (): LogBuffer => ({ entries: [] });

const flushBuffer = (label: string, buffer: LogBuffer): void => {
	if (buffer.entries.length > 0) {
		core.info(`--- Buffered output for "${label}" ---`);
		for (const entry of buffer.entries) {
			core.info(entry);
		}
		core.info(`--- End buffered output for "${label}" ---`);
	}
};

/**
 * Live implementation of the ActionLogger service.
 */
export const ActionLoggerLive: Layer.Layer<ActionLogger> = Layer.succeed(ActionLogger, {
	group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
		Effect.acquireUseRelease(
			Effect.sync(() => core.startGroup(name)),
			() => effect,
			() => Effect.sync(() => core.endGroup()),
		) as Effect.Effect<A, E, Exclude<R, Scope>>,

	withBuffer: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) =>
		FiberRef.get(CurrentLogLevel).pipe(
			Effect.flatMap((level) => {
				if (level !== "info") {
					return effect;
				}
				const buffer = createBuffer();
				const bufferingLogger = Logger.make(({ logLevel, message }) => {
					const text = formatMessage(message);
					core.debug(text);
					if (LogLevel.greaterThanEqual(logLevel, LogLevel.Warning)) {
						emitToGitHub(logLevel, text);
					} else {
						buffer.entries.push(text);
					}
				});
				return effect.pipe(
					Logger.withMinimumLogLevel(LogLevel.All),
					Effect.provide(Logger.replace(Logger.defaultLogger, bufferingLogger)),
					Effect.tapErrorCause(() => Effect.sync(() => flushBuffer(label, buffer))),
				);
			}),
		) as Effect.Effect<A, E, Exclude<R, Scope>>,

	annotationError: (message, properties) =>
		Effect.sync(() => {
			properties !== undefined ? core.error(message, properties) : core.error(message);
		}),

	annotationWarning: (message, properties) =>
		Effect.sync(() => {
			properties !== undefined ? core.warning(message, properties) : core.warning(message);
		}),

	annotationNotice: (message, properties) =>
		Effect.sync(() => {
			properties !== undefined ? core.notice(message, properties) : core.notice(message);
		}),
});
