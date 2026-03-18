import type { Effect, Option, Schema } from "effect";
import { Context } from "effect";
import type { ActionInputError } from "../errors/ActionInputError.js";

/**
 * Service for reading GitHub Action inputs with schema validation.
 *
 * @public
 */
export class ActionInputs extends Context.Tag("github-action-effects/ActionInputs")<
	ActionInputs,
	{
		/**
		 * Read a required input and validate it against a schema.
		 */
		readonly get: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => Effect.Effect<A, ActionInputError>;

		/**
		 * Read an optional input. Returns `Option.none()` if empty.
		 */
		readonly getOptional: <A, I>(
			name: string,
			schema: Schema.Schema<A, I, never>,
		) => Effect.Effect<Option.Option<A>, ActionInputError>;

		/**
		 * Read a required input and mask it as a secret in logs.
		 */
		readonly getSecret: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => Effect.Effect<A, ActionInputError>;

		/**
		 * Read a required input as a JSON string, parse and validate it.
		 */
		readonly getJson: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => Effect.Effect<A, ActionInputError>;

		/**
		 * Read a multiline input (newline-delimited list).
		 * Splits on newlines, trims each line, filters blank lines and comment lines (starting with #).
		 * Each remaining item is validated against the schema.
		 */
		readonly getMultiline: <A, I>(
			name: string,
			itemSchema: Schema.Schema<A, I, never>,
		) => Effect.Effect<Array<A>, ActionInputError>;

		/**
		 * Read a boolean input. Accepts "true"/"false" (case-insensitive).
		 */
		readonly getBoolean: (name: string) => Effect.Effect<boolean, ActionInputError>;

		/**
		 * Read an optional boolean input with a default value.
		 * Returns the default if the input is not provided.
		 */
		readonly getBooleanOptional: (name: string, defaultValue: boolean) => Effect.Effect<boolean, ActionInputError>;
	}
>() {}
