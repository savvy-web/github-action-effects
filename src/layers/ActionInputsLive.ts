import * as core from "@actions/core";
import { Effect, Layer, Option, Schema } from "effect";
import { ActionInputError } from "../errors/ActionInputError.js";
import { ActionInputs } from "../services/ActionInputs.js";

const decodeInput = <A, I>(
	name: string,
	raw: string,
	schema: Schema.Schema<A, I, never>,
): Effect.Effect<A, ActionInputError> =>
	Schema.decode(schema)(raw as unknown as I).pipe(
		Effect.mapError(
			(parseError) =>
				new ActionInputError({
					inputName: name,
					reason: `Input "${name}" validation failed: ${parseError.message}`,
					rawValue: raw,
				}),
		),
	);

export const ActionInputsLive: Layer.Layer<ActionInputs> = Layer.succeed(ActionInputs, {
	get: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = core.getInput(name, { required: true });
		return decodeInput(name, raw, schema);
	},

	getOptional: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = core.getInput(name, { required: false });
		if (raw === "") {
			return Effect.succeed(Option.none<A>());
		}
		return decodeInput(name, raw, schema).pipe(Effect.map((a) => Option.some(a)));
	},

	getSecret: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = core.getInput(name, { required: true });
		core.setSecret(raw);
		return decodeInput(name, raw, schema);
	},

	getJson: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = core.getInput(name, { required: true });
		return Effect.try({
			try: () => JSON.parse(raw) as unknown,
			catch: (error) =>
				new ActionInputError({
					inputName: name,
					reason: `Input "${name}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
					rawValue: raw,
				}),
		}).pipe(
			Effect.flatMap((parsed) =>
				Schema.decode(schema)(parsed as I).pipe(
					Effect.mapError(
						(parseError) =>
							new ActionInputError({
								inputName: name,
								reason: `Input "${name}" JSON validation failed: ${parseError.message}`,
								rawValue: raw,
							}),
					),
				),
			),
		);
	},
});
