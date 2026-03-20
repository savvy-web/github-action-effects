import { FileSystem } from "@effect/platform";
import { Effect, Layer, Schema } from "effect";
import { ActionOutputError } from "../errors/ActionOutputError.js";
import type { RuntimeEnvironmentError } from "../errors/RuntimeEnvironmentError.js";
import * as RuntimeFile from "../runtime/RuntimeFile.js";
import * as WorkflowCommand from "../runtime/WorkflowCommand.js";
import { ActionOutputs } from "../services/ActionOutputs.js";

export const ActionOutputsLive: Layer.Layer<ActionOutputs, never, FileSystem.FileSystem> = Layer.effect(
	ActionOutputs,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const fsLayer = Layer.succeed(FileSystem.FileSystem, fs);

		const appendToFile = (envVar: string, name: string, value: string) =>
			RuntimeFile.append(envVar, name, value).pipe(Effect.provide(fsLayer));

		return {
			set: (name, value) =>
				appendToFile("GITHUB_OUTPUT", name, value).pipe(
					Effect.mapError(
						(error: RuntimeEnvironmentError) =>
							new ActionOutputError({
								outputName: name,
								reason: error.message,
							}),
					),
					Effect.catchTag("ActionOutputError", (e) => Effect.die(e)),
				),

			setJson: <A, I>(name: string, value: A, schema: Schema.Schema<A, I, never>) =>
				Schema.encode(schema)(value).pipe(
					Effect.flatMap((encoded) => appendToFile("GITHUB_OUTPUT", name, JSON.stringify(encoded))),
					Effect.asVoid,
					Effect.mapError(
						(error) =>
							new ActionOutputError({
								outputName: name,
								reason:
									error._tag === "RuntimeEnvironmentError"
										? error.message
										: `Output "${name}" validation failed: ${error.message}`,
							}),
					),
				),

			summary: (content) => {
				const filePath = process.env.GITHUB_STEP_SUMMARY;
				if (filePath === undefined) {
					return Effect.fail(
						new ActionOutputError({
							outputName: "summary",
							reason: "Environment variable GITHUB_STEP_SUMMARY is not set",
						}),
					);
				}
				return fs.writeFileString(filePath, content, { flag: "a" }).pipe(
					Effect.asVoid,
					Effect.mapError(
						(error) =>
							new ActionOutputError({
								outputName: "summary",
								reason: `Failed to write step summary: ${error.description ?? String(error)}`,
							}),
					),
				);
			},

			exportVariable: (name, value) =>
				appendToFile("GITHUB_ENV", name, value).pipe(
					Effect.tap(() => Effect.sync(() => (process.env[name] = value))),
					Effect.orDie,
				),

			addPath: (path) => {
				const filePath = process.env.GITHUB_PATH;
				if (filePath === undefined) {
					return Effect.sync(() => {
						process.env.PATH = `${path}:${process.env.PATH ?? ""}`;
					});
				}
				return fs.writeFileString(filePath, `${path}\n`, { flag: "a" }).pipe(
					Effect.tap(() =>
						Effect.sync(() => {
							process.env.PATH = `${path}:${process.env.PATH ?? ""}`;
						}),
					),
					Effect.asVoid,
					Effect.orDie,
				);
			},

			setFailed: (message) =>
				Effect.sync(() => {
					WorkflowCommand.issue("error", {}, message);
					process.exitCode = 1;
				}),

			setSecret: (value) =>
				Effect.sync(() => {
					WorkflowCommand.issue("add-mask", {}, value);
				}),
		};
	}),
);
