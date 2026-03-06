import type { Schema } from "effect";
import { Effect, Layer, Option } from "effect";
import { ActionInputError } from "../errors/ActionInputError.js";
import { ActionInputs } from "../services/ActionInputs.js";
import { decodeInput, decodeJsonInput } from "./internal/decodeInput.js";

const missingInput = (name: string): ActionInputError =>
	new ActionInputError({
		inputName: name,
		reason: `Input "${name}" is required but not provided`,
		rawValue: undefined,
	});

/**
 * Test implementation that reads from a provided record.
 *
 * @example
 * ```ts
 * const layer = ActionInputsTest.layer({ "package-name": "my-pkg" });
 * ```
 */
export const ActionInputsTest = {
	layer: (inputs: Record<string, string>): Layer.Layer<ActionInputs> =>
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
				return decodeJsonInput(name, raw, schema);
			},
		}),
} as const;
