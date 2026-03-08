import { FileSystem } from "@effect/platform";
import { Effect, Layer, Schema } from "effect";
import { ConfigLoaderError } from "../errors/ConfigLoaderError.js";
import { ConfigLoader } from "../services/ConfigLoader.js";

const importJsoncParser = (path: string) =>
	Effect.tryPromise({
		try: () => import("jsonc-parser"),
		catch: () =>
			new ConfigLoaderError({
				path,
				operation: "parse",
				reason: "jsonc-parser is not installed. Add it as a dependency to use loadJsonc.",
			}),
	});

const importYaml = (path: string) =>
	Effect.tryPromise({
		try: () => import("yaml"),
		catch: () =>
			new ConfigLoaderError({
				path,
				operation: "parse",
				reason: "yaml is not installed. Add it as a dependency to use loadYaml.",
			}),
	});

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
			Effect.all([readFile(fs, path), importJsoncParser(path)] as const).pipe(
				Effect.flatMap(([content, jsonc]) =>
					Effect.try({
						try: () => jsonc.parse(content) as unknown,
						catch: (error) =>
							new ConfigLoaderError({
								path,
								operation: "parse",
								reason: `Invalid JSONC: ${error instanceof Error ? error.message : String(error)}`,
							}),
					}),
				),
				Effect.flatMap((data) => validate(path, schema, data)),
				Effect.withSpan("ConfigLoader.loadJsonc", { attributes: { path } }),
			),

		loadYaml: <T>(path: string, schema: Schema.Schema<T>) =>
			Effect.all([readFile(fs, path), importYaml(path)] as const).pipe(
				Effect.flatMap(([content, yamlMod]) =>
					Effect.try({
						try: () => yamlMod.parse(content) as unknown,
						catch: (error) =>
							new ConfigLoaderError({
								path,
								operation: "parse",
								reason: `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
							}),
					}),
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
