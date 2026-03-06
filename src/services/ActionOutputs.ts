import type { Effect, Schema } from "effect";
import { Context } from "effect";
import type { ActionOutputError } from "../errors/ActionOutputError.js";

/**
 * Service interface for setting GitHub Action outputs with schema validation.
 *
 * @public
 */
export interface ActionOutputs {
	/**
	 * Set a string output value.
	 */
	readonly set: (name: string, value: string) => Effect.Effect<void>;

	/**
	 * Serialize a value as JSON and set it as an output.
	 * Validates against the schema before serializing.
	 */
	readonly setJson: <A, I>(
		name: string,
		value: A,
		schema: Schema.Schema<A, I, never>,
	) => Effect.Effect<void, ActionOutputError>;

	/**
	 * Write markdown content to the step summary.
	 */
	readonly summary: (content: string) => Effect.Effect<void, ActionOutputError>;

	/**
	 * Export an environment variable for subsequent steps.
	 */
	readonly exportVariable: (name: string, value: string) => Effect.Effect<void>;

	/**
	 * Add a directory to PATH for subsequent steps.
	 */
	readonly addPath: (path: string) => Effect.Effect<void>;
}

/**
 * ActionOutputs tag for dependency injection.
 *
 * @public
 */
export const ActionOutputs = Context.GenericTag<ActionOutputs>("ActionOutputs");
