import type { AnnotationProperties } from "@actions/core";
import { Effect, FiberRef, Layer } from "effect";
import type { Scope } from "effect/Scope";
import { ActionLogger } from "../services/ActionLogger.js";
import { CurrentLogLevel } from "./ActionLoggerLive.js";

/**
 * In-memory state captured by the test logger.
 */
export interface ActionLoggerTestState {
	readonly entries: Array<{ readonly level: string; readonly message: string }>;
	readonly groups: Array<{
		readonly name: string;
		readonly entries: Array<{ readonly level: string; readonly message: string }>;
	}>;
	readonly annotations: Array<{
		readonly message: string;
		readonly properties?: AnnotationProperties;
	}>;
	readonly flushedBuffers: Array<{
		readonly label: string;
		readonly entries: Array<string>;
	}>;
}

/**
 * Test implementation that captures log operations in memory.
 *
 * @example
 * ```ts
 * const state = ActionLoggerTest.empty();
 * const layer = ActionLoggerTest.layer(state);
 * ```
 */
export const ActionLoggerTest = {
	/**
	 * Create a fresh empty test state container.
	 */
	empty: (): ActionLoggerTestState => ({
		entries: [],
		groups: [],
		annotations: [],
		flushedBuffers: [],
	}),

	/**
	 * Create a test layer from the given state.
	 */
	layer: (state: ActionLoggerTestState): Layer.Layer<ActionLogger> =>
		Layer.succeed(ActionLogger, {
			group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => {
				const groupEntries: Array<{ level: string; message: string }> = [];
				state.groups.push({ name, entries: groupEntries });
				return effect;
			},

			withBuffer: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) =>
				FiberRef.get(CurrentLogLevel).pipe(
					Effect.flatMap((level) => {
						if (level !== "info") {
							return effect;
						}
						const bufferEntries: Array<string> = [];
						return effect.pipe(
							Effect.tapErrorCause(() =>
								Effect.sync(() => {
									state.flushedBuffers.push({
										label,
										entries: bufferEntries,
									});
								}),
							),
						);
					}),
				) as Effect.Effect<A, E, Exclude<R, Scope>>,

			annotation: (message, properties) =>
				Effect.sync(() => {
					state.annotations.push({
						message,
						...(properties !== undefined ? { properties } : {}),
					});
				}),
		}),
} as const;
