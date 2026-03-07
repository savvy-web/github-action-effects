import type { Effect, Option, Schema } from "effect";
import { Context } from "effect";
import type { ActionStateError } from "../errors/ActionStateError.js";

/**
 * Service interface for reading and writing GitHub Action state
 * with schema-based serialization across action phases (pre/main/post).
 *
 * @public
 */
export interface ActionState {
	/**
	 * Save a value to action state. Uses Schema.encode to serialize
	 * complex objects to JSON strings for storage.
	 */
	readonly save: <A, I>(
		key: string,
		value: A,
		schema: Schema.Schema<A, I, never>,
	) => Effect.Effect<void, ActionStateError>;

	/**
	 * Read a required state value. Uses Schema.decode to deserialize
	 * and validate the stored JSON string.
	 */
	readonly get: <A, I>(key: string, schema: Schema.Schema<A, I, never>) => Effect.Effect<A, ActionStateError>;

	/**
	 * Read an optional state value. Returns Option.none() if the key
	 * has no stored value.
	 */
	readonly getOptional: <A, I>(
		key: string,
		schema: Schema.Schema<A, I, never>,
	) => Effect.Effect<Option.Option<A>, ActionStateError>;
}

/**
 * ActionState tag for dependency injection.
 *
 * @public
 */
export const ActionState = Context.GenericTag<ActionState>("ActionState");
