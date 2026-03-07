import type { Schema } from "effect";
import { Effect } from "effect";
import type { ActionInputError } from "../errors/ActionInputError.js";
import { ActionInputs } from "./ActionInputs.js";

/**
 * Configuration for a single input in parseAllInputs.
 *
 * @public
 */
export interface InputConfig<S extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext> {
	readonly schema: S;
	readonly required?: boolean;
	readonly default?: Schema.Schema.Type<S>;
	readonly multiline?: boolean;
	readonly secret?: boolean;
	readonly json?: boolean;
}

/**
 * Infer the output type from an input config record.
 */
type ParsedInputs<T extends Record<string, InputConfig>> = {
	readonly [K in keyof T]: T[K] extends InputConfig<infer S> ? Schema.Schema.Type<S> : never;
};

/**
 * Read and validate all inputs at once, with optional cross-validation.
 *
 * @example
 * ```ts
 * const inputs = yield* parseAllInputs({
 *   "app-id": { schema: Schema.NumberFromString, required: true },
 *   "branch": { schema: Schema.String, default: "main" },
 *   "update-pnpm": { schema: Schema.Boolean, default: true },
 * })
 * ```
 *
 * @public
 */
export const parseAllInputs = <T extends Record<string, InputConfig>>(
	config: T,
	crossValidate?: (parsed: ParsedInputs<T>) => Effect.Effect<ParsedInputs<T>, ActionInputError>,
): Effect.Effect<ParsedInputs<T>, ActionInputError, ActionInputs> =>
	Effect.flatMap(ActionInputs, (svc) => {
		const entries = Object.entries(config);

		return Effect.forEach(entries, ([name, cfg]) => {
			const { schema, json, multiline, secret } = cfg;
			const isOptional = cfg.required === false || cfg.default !== undefined;
			let readEffect: Effect.Effect<unknown, ActionInputError>;

			if (json) {
				readEffect = svc.getJson(name, schema);
			} else if (multiline) {
				readEffect = svc.getMultiline(name, schema);
			} else if (secret) {
				readEffect = svc.getSecret(name, schema);
			} else if (isOptional) {
				readEffect = svc.getOptional(name, schema).pipe(
					Effect.map((opt) => {
						if (opt._tag === "None") {
							return cfg.default;
						}
						return opt.value;
					}),
				);
			} else {
				readEffect = svc.get(name, schema);
			}

			return Effect.map(readEffect, (value) => [name, value] as const);
		}).pipe(
			Effect.map((pairs) => Object.fromEntries(pairs) as ParsedInputs<T>),
			Effect.flatMap((parsed) => (crossValidate ? crossValidate(parsed) : Effect.succeed(parsed))),
		);
	});
