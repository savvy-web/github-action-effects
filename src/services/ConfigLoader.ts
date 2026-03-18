import type { Effect, Schema } from "effect";
import { Context } from "effect";
import type { ConfigLoaderError } from "../errors/ConfigLoaderError.js";

/**
 * Service interface for loading and validating config files.
 *
 * Supports JSON, JSONC, and YAML formats with Effect Schema validation.
 *
 * @public
 */
export interface ConfigLoader {
	/** Load and validate a JSON config file. */
	readonly loadJson: <T>(path: string, schema: Schema.Schema<T>) => Effect.Effect<T, ConfigLoaderError>;

	/** Load and validate a JSONC (JSON with Comments) config file. */
	readonly loadJsonc: <T>(path: string, schema: Schema.Schema<T>) => Effect.Effect<T, ConfigLoaderError>;

	/** Load and validate a YAML config file. */
	readonly loadYaml: <T>(path: string, schema: Schema.Schema<T>) => Effect.Effect<T, ConfigLoaderError>;

	/** Check if a config file exists at the given path. */
	readonly exists: (path: string) => Effect.Effect<boolean>;
}

/**
 * ConfigLoader tag for dependency injection.
 *
 * @public
 */
export const ConfigLoader = Context.GenericTag<ConfigLoader>("ConfigLoader");
