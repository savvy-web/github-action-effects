import * as core from "@actions/core";
import type { Schema } from "effect";
import { Effect, Layer, Option, Schema as S } from "effect";
import { ActionStateError } from "../errors/ActionStateError.js";
import { ActionState } from "../services/ActionState.js";

const encode = <A, I>(
	key: string,
	value: A,
	schema: Schema.Schema<A, I, never>,
): Effect.Effect<string, ActionStateError> =>
	S.encode(schema)(value).pipe(
		Effect.map((encoded) => JSON.stringify(encoded)),
		Effect.mapError(
			(error) =>
				new ActionStateError({
					key,
					reason: `State "${key}" encode failed: ${error instanceof Error ? error.message : String(error)}`,
					rawValue: undefined,
				}),
		),
	);

const decodeState = <A, I>(
	key: string,
	raw: string,
	schema: Schema.Schema<A, I, never>,
): Effect.Effect<A, ActionStateError> =>
	Effect.try({
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

export const ActionStateLive: Layer.Layer<ActionState> = Layer.succeed(ActionState, {
	save: <A, I>(key: string, value: A, schema: Schema.Schema<A, I, never>) =>
		encode(key, value, schema).pipe(
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
});
