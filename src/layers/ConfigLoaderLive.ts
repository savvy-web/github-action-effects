import { FileSystem } from "@effect/platform";
import { Effect, Layer, Schema } from "effect";
import { parse as parseJsonc } from "jsonc-effect";
import { parse as parseYaml } from "yaml-effect";
import { ConfigLoaderError } from "../errors/ConfigLoaderError.js";
import { ConfigLoader } from "../services/ConfigLoader.js";

const readFile = (fs: FileSystem.FileSystem, path: string): Effect.Effect<string, ConfigLoaderError> =>
	fs.readFileString(path).pipe(
		Effect.mapError(
			(error) =>
				new ConfigLoaderError({
					path,
					operation: "read",
					reason: `Failed to read file: ${error.message}`,
				}),
		),
	);

const validate = <T>(path: string, schema: Schema.Schema<T>, data: unknown): Effect.Effect<T, ConfigLoaderError> =>
	Schema.decodeUnknown(schema)(data).pipe(
		Effect.mapError(
			(error) =>
				new ConfigLoaderError({
					path,
					operation: "validate",
					reason: `Schema validation failed: ${error.message}`,
				}),
		),
	);

/**
 * Live implementation of ConfigLoader using `@effect/platform` FileSystem.
 *
 * @public
 */
export const ConfigLoaderLive: Layer.Layer<ConfigLoader, never, FileSystem.FileSystem> = Layer.effect(
	ConfigLoader,
	Effect.map(FileSystem.FileSystem, (fs) => ({
		loadJson: <T>(path: string, schema: Schema.Schema<T>) =>
			readFile(fs, path).pipe(
				Effect.flatMap((content) =>
					Effect.try({
						try: () => JSON.parse(content) as unknown,
						catch: (error) =>
							new ConfigLoaderError({
								path,
								operation: "parse",
								reason: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
							}),
					}),
				),
				Effect.flatMap((data) => validate(path, schema, data)),
				Effect.withSpan("ConfigLoader.loadJson", { attributes: { path } }),
			),

		loadJsonc: <T>(path: string, schema: Schema.Schema<T>) =>
			readFile(fs, path).pipe(
				Effect.flatMap((content) =>
					parseJsonc(content).pipe(
						Effect.mapError(
							(error) =>
								new ConfigLoaderError({
									path,
									operation: "parse",
									reason: `Invalid JSONC: ${error.message}`,
								}),
						),
					),
				),
				Effect.flatMap((data) => validate(path, schema, data)),
				Effect.withSpan("ConfigLoader.loadJsonc", { attributes: { path } }),
			),

		loadYaml: <T>(path: string, schema: Schema.Schema<T>) =>
			readFile(fs, path).pipe(
				Effect.flatMap((content) =>
					parseYaml(content).pipe(
						Effect.mapError(
							(error) =>
								new ConfigLoaderError({
									path,
									operation: "parse",
									reason: `Invalid YAML: ${error.message}`,
								}),
						),
					),
				),
				Effect.flatMap((data) => validate(path, schema, data)),
				Effect.withSpan("ConfigLoader.loadYaml", { attributes: { path } }),
			),

		exists: (path: string) =>
			fs.access(path).pipe(
				Effect.map(() => true),
				Effect.catchAll(() => Effect.succeed(false)),
				Effect.withSpan("ConfigLoader.exists", { attributes: { path } }),
			),
	})),
);
