import { Effect, Layer, Schema } from "effect";
import { ActionOutputError } from "../errors/ActionOutputError.js";
import type { CapturedOutput } from "../schemas/GithubMarkdown.js";
import { ActionOutputs } from "../services/ActionOutputs.js";

/**
 * In-memory state captured by the test output layer.
 */
export interface ActionOutputsTestState {
	readonly outputs: Array<CapturedOutput>;
	readonly summaries: Array<string>;
	readonly variables: Array<CapturedOutput>;
	readonly paths: Array<string>;
	readonly secrets: Array<string>;
	readonly failed: Array<string>;
}

/**
 * Test implementation that captures outputs in memory.
 *
 * @example
 * ```ts
 * const state = ActionOutputsTest.empty();
 * const layer = ActionOutputsTest.layer(state);
 * ```
 */
export const ActionOutputsTest = {
	/**
	 * Create a fresh empty test state container.
	 */
	empty: (): ActionOutputsTestState => ({
		outputs: [],
		summaries: [],
		variables: [],
		paths: [],
		secrets: [],
		failed: [],
	}),

	/**
	 * Create a test layer from the given state.
	 */
	layer: (state: ActionOutputsTestState): Layer.Layer<ActionOutputs> =>
		Layer.succeed(ActionOutputs, {
			set: (name, value) =>
				Effect.sync(() => {
					state.outputs.push({ name, value });
				}),

			setJson: <A, I>(name: string, value: A, schema: Schema.Schema<A, I, never>) =>
				Schema.encode(schema)(value).pipe(
					Effect.tap((encoded) =>
						Effect.sync(() => {
							state.outputs.push({ name, value: JSON.stringify(encoded) });
						}),
					),
					Effect.asVoid,
					Effect.mapError(
						(parseError) =>
							new ActionOutputError({
								outputName: name,
								reason: `Output "${name}" validation failed: ${parseError.message}`,
							}),
					),
				),

			summary: (content) =>
				Effect.sync(() => {
					state.summaries.push(content);
				}),

			exportVariable: (name, value) =>
				Effect.sync(() => {
					state.variables.push({ name, value });
				}),

			addPath: (path) =>
				Effect.sync(() => {
					state.paths.push(path);
				}),

			setFailed: (message) =>
				Effect.sync(() => {
					state.failed.push(message);
				}),

			setSecret: (value) =>
				Effect.sync(() => {
					state.secrets.push(value);
				}),
		}),
} as const;
