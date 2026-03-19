import { Effect, Layer, Schema } from "effect";
import { ActionOutputError } from "../errors/ActionOutputError.js";
import { ActionOutputs } from "../services/ActionOutputs.js";
import { ActionsCore } from "../services/ActionsCore.js";

export const ActionOutputsLive: Layer.Layer<ActionOutputs, never, ActionsCore> = Layer.effect(
	ActionOutputs,
	Effect.gen(function* () {
		const core = yield* ActionsCore;

		return {
			set: (name, value) => Effect.sync(() => core.setOutput(name, value)),

			setJson: <A, I>(name: string, value: A, schema: Schema.Schema<A, I, never>) =>
				Schema.encode(schema)(value).pipe(
					Effect.tap((encoded) => Effect.sync(() => core.setOutput(name, JSON.stringify(encoded)))),
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
				Effect.tryPromise({
					try: () => core.summary.addRaw(content).write(),
					catch: (error) =>
						new ActionOutputError({
							outputName: "summary",
							reason: `Failed to write step summary: ${error instanceof Error ? error.message : String(error)}`,
						}),
				}).pipe(Effect.asVoid),

			exportVariable: (name, value) => Effect.sync(() => core.exportVariable(name, value)),

			addPath: (path) => Effect.sync(() => core.addPath(path)),

			setFailed: (message) => Effect.sync(() => core.setFailed(message)),

			setSecret: (value) => Effect.sync(() => core.setSecret(value)),
		};
	}),
);
