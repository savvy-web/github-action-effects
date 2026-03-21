import { FileSystem } from "@effect/platform";
import type { Schema } from "effect";
import { Effect, Layer, Option } from "effect";
import { ActionStateError } from "../errors/ActionStateError.js";
import * as RuntimeFile from "../runtime/RuntimeFile.js";
import { ActionState } from "../services/ActionState.js";
import { decodeState, encodeState } from "./internal/decodeState.js";

export const ActionStateLive: Layer.Layer<ActionState, never, FileSystem.FileSystem> = Layer.effect(
	ActionState,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const fsLayer = Layer.succeed(FileSystem.FileSystem, fs);

		return {
			save: <A, I>(key: string, value: A, schema: Schema.Schema<A, I, never>) =>
				encodeState(key, value, schema).pipe(
					Effect.flatMap((json) => RuntimeFile.append("GITHUB_STATE", key, json).pipe(Effect.provide(fsLayer))),
					Effect.orDie,
				),

			get: <A, I>(key: string, schema: Schema.Schema<A, I, never>) =>
				Effect.sync(() => process.env[`STATE_${key}`] ?? "").pipe(
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
				Effect.sync(() => process.env[`STATE_${key}`] ?? "").pipe(
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
