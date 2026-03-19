import type { Schema } from "effect";
import { Effect, Layer, Option } from "effect";
import { ActionStateError } from "../errors/ActionStateError.js";
import { ActionState } from "../services/ActionState.js";
import { ActionsCore } from "../services/ActionsCore.js";
import { decodeState, encodeState } from "./internal/decodeState.js";

export const ActionStateLive: Layer.Layer<ActionState, never, ActionsCore> = Layer.effect(
	ActionState,
	Effect.gen(function* () {
		const core = yield* ActionsCore;
		return {
			save: <A, I>(key: string, value: A, schema: Schema.Schema<A, I, never>) =>
				encodeState(key, value, schema).pipe(
					Effect.tap((json) => Effect.sync(() => core.saveState(key, json))),
					Effect.asVoid,
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
				),

			getOptional: <A, I>(key: string, schema: Schema.Schema<A, I, never>) =>
				Effect.sync(() => core.getState(key)).pipe(
					Effect.flatMap((raw) => {
						if (raw === "") {
							return Effect.succeed(Option.none<A>());
						}
						return decodeState(key, raw, schema).pipe(Effect.map((a) => Option.some(a)));
					}),
				),
		};
	}),
);
