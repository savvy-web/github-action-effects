import type { Effect, Schema } from "effect";
import { Context } from "effect";
import type { ActionOutputError } from "../errors/ActionOutputError.js";

/**
 * Service for setting GitHub Action outputs with schema validation.
 *
 * @public
 */
export class ActionOutputs extends Context.Tag("github-action-effects/ActionOutputs")<
	ActionOutputs,
	{
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

		/**
		 * Mark the action as failed with a message.
		 * This is the standard way to signal action failure.
		 */
		readonly setFailed: (message: string) => Effect.Effect<void>;

		/**
		 * Register a value as a secret so it is masked in logs.
		 * Use for values not read through ActionInputs (e.g., generated tokens).
		 */
		readonly setSecret: (value: string) => Effect.Effect<void>;
	}
>() {}
