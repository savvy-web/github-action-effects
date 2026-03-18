import { Effect, Layer, Schema } from "effect";
import { ConfigLoaderError } from "../errors/ConfigLoaderError.js";
import { ConfigLoader } from "../services/ConfigLoader.js";

/**
 * Test state for ConfigLoader.
 *
 * @public
 */
export interface ConfigLoaderTestState {
	/** Map of file path to raw file content. */
	readonly files: Map<string, string>;
}

const makeTestConfigLoader = (state: ConfigLoaderTestState): typeof ConfigLoader.Service => ({
	loadJson: <T>(path: string, schema: Schema.Schema<T>) => {
		const content = state.files.get(path);
		if (content === undefined) {
			return Effect.fail(
				new ConfigLoaderError({
					path,
					operation: "read",
					reason: `File not found: ${path}`,
				}),
			);
		}
		return Effect.try({
			try: () => JSON.parse(content) as unknown,
			catch: (error) =>
				new ConfigLoaderError({
					path,
					operation: "parse",
					reason: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
				}),
		}).pipe(
			Effect.flatMap((data) =>
				Schema.decodeUnknown(schema)(data).pipe(
					Effect.mapError(
						(error) =>
							new ConfigLoaderError({
								path,
								operation: "validate",
								reason: `Schema validation failed: ${error.message}`,
							}),
					),
				),
			),
		);
	},

	loadJsonc: <T>(path: string, schema: Schema.Schema<T>) => {
		const content = state.files.get(path);
		if (content === undefined) {
			return Effect.fail(
				new ConfigLoaderError({
					path,
					operation: "read",
					reason: `File not found: ${path}`,
				}),
			);
		}
		// Simple JSONC handling for tests: strip single-line comments and parse
		const stripped = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
		return Effect.try({
			try: () => JSON.parse(stripped) as unknown,
			catch: (error) =>
				new ConfigLoaderError({
					path,
					operation: "parse",
					reason: `Invalid JSONC: ${error instanceof Error ? error.message : String(error)}`,
				}),
		}).pipe(
			Effect.flatMap((data) =>
				Schema.decodeUnknown(schema)(data).pipe(
					Effect.mapError(
						(error) =>
							new ConfigLoaderError({
								path,
								operation: "validate",
								reason: `Schema validation failed: ${error.message}`,
							}),
					),
				),
			),
		);
	},

	loadYaml: <T>(path: string, schema: Schema.Schema<T>) => {
		const content = state.files.get(path);
		if (content === undefined) {
			return Effect.fail(
				new ConfigLoaderError({
					path,
					operation: "read",
					reason: `File not found: ${path}`,
				}),
			);
		}
		// Simple YAML-like parsing for tests: parse key: value lines
		const result: Record<string, unknown> = {};
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
			const colonIndex = trimmed.indexOf(":");
			if (colonIndex === -1) continue;
			const key = trimmed.slice(0, colonIndex).trim();
			const rawValue = trimmed.slice(colonIndex + 1).trim();
			// Attempt to parse booleans and numbers
			if (rawValue === "true") result[key] = true;
			else if (rawValue === "false") result[key] = false;
			else if (rawValue !== "" && !Number.isNaN(Number(rawValue))) result[key] = Number(rawValue);
			else result[key] = rawValue;
		}
		return Schema.decodeUnknown(schema)(result).pipe(
			Effect.mapError(
				(error) =>
					new ConfigLoaderError({
						path,
						operation: "validate",
						reason: `Schema validation failed: ${error.message}`,
					}),
			),
		);
	},

	exists: (path: string) => Effect.succeed(state.files.has(path)),
});

/**
 * Test implementation for ConfigLoader.
 *
 * @public
 */
export const ConfigLoaderTest = {
	/** Create test layer with pre-configured state. */
	layer: (state: ConfigLoaderTestState): Layer.Layer<ConfigLoader> =>
		Layer.succeed(ConfigLoader, makeTestConfigLoader(state)),

	/** Create a fresh empty test state. */
	empty: (): ConfigLoaderTestState => ({
		files: new Map(),
	}),
} as const;
