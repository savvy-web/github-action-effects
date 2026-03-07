import type { Schema } from "effect";
import { Effect, Layer, Option } from "effect";
import { ActionStateError } from "../errors/ActionStateError.js";
import { ActionState } from "../services/ActionState.js";
import { decodeState, encodeState } from "./internal/decodeState.js";

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
				encodeState(key, value, schema).pipe(
					Effect.tap((json) =>
						Effect.sync(() => {
							state.entries.set(key, json);
						}),
					),
					Effect.asVoid,
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
				return decodeState(key, raw, schema);
			},

			getOptional: <A, I>(key: string, schema: Schema.Schema<A, I, never>) => {
				const raw = state.entries.get(key);
				if (raw === undefined) {
					return Effect.succeed(Option.none<A>());
				}
				return decodeState(key, raw, schema).pipe(Effect.map((a) => Option.some(a)));
			},
		}),
} as const;
