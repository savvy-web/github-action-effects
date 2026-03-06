import type { Effect, Option, Schema } from "effect";
import { Context } from "effect";
import type { ActionInputError } from "../errors/ActionInputError.js";

/**
 * Service interface for reading GitHub Action inputs with schema validation.
 *
 * @public
 */
export interface ActionInputs {
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
}

/**
 * ActionInputs tag for dependency injection.
 *
 * @public
 */
export const ActionInputs = Context.GenericTag<ActionInputs>("ActionInputs");
