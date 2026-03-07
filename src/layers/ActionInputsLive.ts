import * as core from "@actions/core";
import type { Schema } from "effect";
import { Effect, Layer, Option } from "effect";
import { ActionInputError } from "../errors/ActionInputError.js";
import { ActionInputs } from "../services/ActionInputs.js";
import { decodeInput, decodeJsonInput } from "./internal/decodeInput.js";

export const ActionInputsLive: Layer.Layer<ActionInputs> = Layer.succeed(ActionInputs, {
	get: <A, I>(name: string, schema: Schema.Schema<A, I, never>) =>
		Effect.sync(() => core.getInput(name, { required: true })).pipe(
			Effect.flatMap((raw) => decodeInput(name, raw, schema)),
		),

	getOptional: <A, I>(name: string, schema: Schema.Schema<A, I, never>) =>
		Effect.sync(() => core.getInput(name, { required: false })).pipe(
			Effect.flatMap((raw) => {
				if (raw === "") {
					return Effect.succeed(Option.none<A>());
				}
				return decodeInput(name, raw, schema).pipe(Effect.map((a) => Option.some(a)));
			}),
		),

	getSecret: <A, I>(name: string, schema: Schema.Schema<A, I, never>) =>
		Effect.sync(() => {
			const raw = core.getInput(name, { required: true });
			core.setSecret(raw);
			return raw;
		}).pipe(Effect.flatMap((raw) => decodeInput(name, raw, schema))),

	getJson: <A, I>(name: string, schema: Schema.Schema<A, I, never>) =>
		Effect.sync(() => core.getInput(name, { required: true })).pipe(
			Effect.flatMap((raw) => decodeJsonInput(name, raw, schema)),
		),

	getMultiline: <A, I>(name: string, itemSchema: Schema.Schema<A, I, never>) =>
		Effect.sync(() => core.getMultilineInput(name, { required: true })).pipe(
			Effect.map((lines) => lines.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"))),
			Effect.flatMap((lines) => Effect.forEach(lines, (line) => decodeInput(name, line, itemSchema))),
		),

	getBoolean: (name: string) =>
		Effect.sync(() => core.getInput(name, { required: true })).pipe(
			Effect.flatMap((raw) =>
				Effect.try({
					try: () => core.getBooleanInput(name, { required: true }),
					catch: (error) =>
						new ActionInputError({
							inputName: name,
							reason: `Input "${name}" is not a valid boolean: ${error instanceof Error ? error.message : String(error)}`,
							rawValue: raw,
						}),
				}),
			),
		),

	getBooleanOptional: (name: string, defaultValue: boolean) =>
		Effect.sync(() => core.getInput(name, { required: false })).pipe(
			Effect.flatMap((raw) => {
				if (raw === "") {
					return Effect.succeed(defaultValue);
				}
				return Effect.try({
					try: () => core.getBooleanInput(name, { required: false }),
					catch: (error) =>
						new ActionInputError({
							inputName: name,
							reason: `Input "${name}" is not a valid boolean: ${error instanceof Error ? error.message : String(error)}`,
							rawValue: raw,
						}),
				});
			}),
		),
});
