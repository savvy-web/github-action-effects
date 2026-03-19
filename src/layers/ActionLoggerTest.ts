import { Effect, FiberRef, Layer } from "effect";
import type { Scope } from "effect/Scope";
import { ActionLogger } from "../services/ActionLogger.js";
import type { AnnotationProperties } from "../services/ActionsCore.js";
import { CurrentLogLevel } from "./ActionLoggerLive.js";

/**
 * Annotation type captured by the test layer.
 */
export type TestAnnotationType = "error" | "warning" | "notice";

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
		readonly type: TestAnnotationType;
		readonly message: string;
		readonly properties?: AnnotationProperties;
	}>;
	readonly flushedBuffers: Array<{
		readonly label: string;
		readonly entries: Array<string>;
	}>;
}

const makeAnnotation =
	(state: ActionLoggerTestState, type: TestAnnotationType) => (message: string, properties?: AnnotationProperties) =>
		Effect.sync(() => {
			state.annotations.push({
				type,
				message,
				...(properties !== undefined ? { properties } : {}),
			});
		});

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
						return effect.pipe(
							Effect.tapErrorCause(() =>
								Effect.sync(() => {
									state.flushedBuffers.push({ label, entries: [] });
								}),
							),
						);
					}),
				) as Effect.Effect<A, E, Exclude<R, Scope>>,

			annotationError: makeAnnotation(state, "error"),
			annotationWarning: makeAnnotation(state, "warning"),
			annotationNotice: makeAnnotation(state, "notice"),
		}),
} as const;
