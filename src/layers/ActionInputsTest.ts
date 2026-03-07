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

const parseBoolean = (name: string, raw: string): Effect.Effect<boolean, ActionInputError> => {
	const lower = raw.toLowerCase().trim();
	if (lower === "true") return Effect.succeed(true);
	if (lower === "false") return Effect.succeed(false);
	return Effect.fail(
		new ActionInputError({
			inputName: name,
			reason: `Input "${name}" is not a valid boolean: expected "true" or "false", got "${raw}"`,
			rawValue: raw,
		}),
	);
};

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

			getMultiline: <A, I>(name: string, itemSchema: Schema.Schema<A, I, never>) => {
				const raw = inputs[name];
				if (raw === undefined) {
					return Effect.fail(missingInput(name));
				}
				const lines = raw
					.split("\n")
					.map((l) => l.trim())
					.filter((l) => l.length > 0 && !l.startsWith("#"));
				return Effect.forEach(lines, (line) => decodeInput(name, line, itemSchema));
			},

			getBoolean: (name: string) => {
				const raw = inputs[name];
				if (raw === undefined) {
					return Effect.fail(missingInput(name));
				}
				return parseBoolean(name, raw);
			},

			getBooleanOptional: (name: string, defaultValue: boolean) => {
				const raw = inputs[name];
				if (raw === undefined || raw === "") {
					return Effect.succeed(defaultValue);
				}
				return parseBoolean(name, raw);
			},
		}),
} as const;
