import type { Schema } from "effect";
import { Effect, Layer, Option, Schema as S } from "effect";
import { ActionStateError } from "../errors/ActionStateError.js";
import { ActionState } from "../services/ActionState.js";

/**
 * In-memory state captured by the test state layer.
 */
export interface ActionStateTestState {
	/** Stored state entries (key to JSON string). */
	readonly entries: Map<string, string>;
}

/**
 * Test implementation that captures state in memory.
 *
 * @example
 * ```ts
 * const state = ActionStateTest.empty();
 * const layer = ActionStateTest.layer(state);
 * ```
 */
export const ActionStateTest = {
	/**
	 * Create a fresh empty test state container.
	 */
	empty: (): ActionStateTestState => ({
		entries: new Map(),
	}),

	/**
	 * Create a test layer from the given state.
	 * Pre-populate entries to simulate state from a previous phase.
	 */
	layer: (state: ActionStateTestState): Layer.Layer<ActionState> =>
		Layer.succeed(ActionState, {
			save: <A, I>(key: string, value: A, schema: Schema.Schema<A, I, never>) =>
				S.encode(schema)(value).pipe(
					Effect.map((encoded) => JSON.stringify(encoded)),
					Effect.tap((json) =>
						Effect.sync(() => {
							state.entries.set(key, json);
						}),
					),
					Effect.asVoid,
					Effect.mapError(
						(error) =>
							new ActionStateError({
								key,
								reason: `State "${key}" encode failed: ${error instanceof Error ? error.message : String(error)}`,
								rawValue: undefined,
							}),
					),
				),

			get: <A, I>(key: string, schema: Schema.Schema<A, I, never>) => {
				const raw = state.entries.get(key);
				if (raw === undefined) {
					return Effect.fail(
						new ActionStateError({
							key,
							reason: `State "${key}" is not set (phase ordering issue?)`,
							rawValue: undefined,
						}),
					);
				}
				return Effect.try({
					try: () => JSON.parse(raw) as unknown,
					catch: (error) =>
						new ActionStateError({
							key,
							reason: `State "${key}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
							rawValue: raw,
						}),
				}).pipe(
					Effect.flatMap((parsed) =>
						S.decode(schema)(parsed as I).pipe(
							Effect.mapError(
								(parseError) =>
									new ActionStateError({
										key,
										reason: `State "${key}" decode failed: ${parseError.message}`,
										rawValue: raw,
									}),
							),
						),
					),
				);
			},

			getOptional: <A, I>(key: string, schema: Schema.Schema<A, I, never>) => {
				const raw = state.entries.get(key);
				if (raw === undefined) {
					return Effect.succeed(Option.none<A>());
				}
				return Effect.try({
					try: () => JSON.parse(raw) as unknown,
					catch: (error) =>
						new ActionStateError({
							key,
							reason: `State "${key}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
							rawValue: raw,
						}),
				}).pipe(
					Effect.flatMap((parsed) =>
						S.decode(schema)(parsed as I).pipe(
							Effect.map((a) => Option.some(a)),
							Effect.mapError(
								(parseError) =>
									new ActionStateError({
										key,
										reason: `State "${key}" decode failed: ${parseError.message}`,
										rawValue: raw,
									}),
							),
						),
					),
				);
			},
		}),
} as const;
