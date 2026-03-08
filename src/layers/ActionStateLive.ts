import * as core from "@actions/core";
import type { Schema } from "effect";
import { Effect, Layer, Option } from "effect";
import { ActionStateError } from "../errors/ActionStateError.js";
import { ActionState } from "../services/ActionState.js";
import { decodeState, encodeState } from "./internal/decodeState.js";

export const ActionStateLive: Layer.Layer<ActionState> = Layer.succeed(ActionState, {
	save: <A, I>(key: string, value: A, schema: Schema.Schema<A, I, never>) =>
		encodeState(key, value, schema).pipe(
			Effect.tap((json) => Effect.sync(() => core.saveState(key, json))),
			Effect.asVoid,
			Effect.withSpan("ActionState.save", { attributes: { "state.key": key } }),
		),

	get: <A, I>(key: string, schema: Schema.Schema<A, I, never>) =>
		Effect.sync(() => core.getState(key)).pipe(
			Effect.flatMap((raw) => {
				if (raw === "") {
					return Effect.fail(
						new ActionStateError({
							key,
							reason: `State "${key}" is not set (phase ordering issue?)`,
							rawValue: undefined,
						}),
					);
				}
				return decodeState(key, raw, schema);
			}),
			Effect.withSpan("ActionState.get", { attributes: { "state.key": key } }),
		),

	getOptional: <A, I>(key: string, schema: Schema.Schema<A, I, never>) =>
		Effect.sync(() => core.getState(key)).pipe(
			Effect.flatMap((raw) => {
				if (raw === "") {
					return Effect.succeed(Option.none<A>());
				}
				return decodeState(key, raw, schema).pipe(Effect.map((a) => Option.some(a)));
			}),
			Effect.withSpan("ActionState.getOptional", { attributes: { "state.key": key } }),
		),
});
