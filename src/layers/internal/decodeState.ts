import { Effect, Schema } from "effect";
import { ActionStateError } from "../../errors/ActionStateError.js";

/**
 * Encode a value using a schema and serialize to JSON string.
 *
 * @internal
 */
export const encodeState = <A, I>(
	key: string,
	value: A,
	schema: Schema.Schema<A, I, never>,
): Effect.Effect<string, ActionStateError> =>
	Schema.encode(schema)(value).pipe(
		Effect.map((encoded) => JSON.stringify(encoded)),
		Effect.mapError(
			(error) =>
				new ActionStateError({
					key,
					reason: `State "${key}" encode failed: ${error instanceof Error ? error.message : String(error)}`,
					rawValue: undefined,
				}),
		),
	);

/**
 * Parse a raw JSON string and decode using a schema.
 *
 * @internal
 */
export const decodeState = <A, I>(
	key: string,
	raw: string,
	schema: Schema.Schema<A, I, never>,
): Effect.Effect<A, ActionStateError> =>
	Effect.try({
		try: () => JSON.parse(raw) as unknown,
		catch: (error) =>
			new ActionStateError({
				key,
				reason: `State "${key}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
				rawValue: raw,
			}),
	}).pipe(
		Effect.flatMap((parsed) =>
			Schema.decode(schema)(parsed as I).pipe(
				Effect.mapError(
					(parseError) =>
						new ActionStateError({
							key,
							reason: `State "${key}" decode failed: ${parseError.message}`,
							rawValue: raw,
						}),
				),
			),
		),
	);
