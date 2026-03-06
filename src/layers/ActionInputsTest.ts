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

const missingInput = (name: string): ActionInputError =>
	new ActionInputError({
		inputName: name,
		reason: `Input "${name}" is required but not provided`,
		rawValue: undefined,
	});

/**
 * Test implementation that reads from a provided record.
 */
export const ActionInputsTest = (inputs: Record<string, string>): Layer.Layer<ActionInputs> =>
	Layer.succeed(ActionInputs, {
		get: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
			const raw = inputs[name];
			if (raw === undefined) {
				return Effect.fail(missingInput(name));
			}
			return decodeInput(name, raw, schema);
		},

		getOptional: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
			const raw = inputs[name];
			if (raw === undefined || raw === "") {
				return Effect.succeed(Option.none<A>());
			}
			return decodeInput(name, raw, schema).pipe(Effect.map((a) => Option.some(a)));
		},

		getSecret: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
			const raw = inputs[name];
			if (raw === undefined) {
				return Effect.fail(missingInput(name));
			}
			return decodeInput(name, raw, schema);
		},

		getJson: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
			const raw = inputs[name];
			if (raw === undefined) {
				return Effect.fail(missingInput(name));
			}
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
