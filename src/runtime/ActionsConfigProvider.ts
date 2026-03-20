import { Array as Arr, ConfigError, ConfigProvider, ConfigProviderPathPatch, Effect, Either, HashSet } from "effect";

/**
 * A `ConfigProvider` that reads GitHub Actions inputs from the process environment.
 *
 * GitHub Actions populates action inputs as environment variables with the prefix
 * `INPUT_`, with spaces replaced by underscores and the name uppercased. Hyphens
 * are preserved (not converted to underscores), matching GitHub Actions behavior.
 *
 * For example:
 * - `Config.string("name")` reads `INPUT_NAME`
 * - `Config.string("retry-count")` reads `INPUT_RETRY-COUNT`
 * - `Config.string("my input")` reads `INPUT_MY_INPUT`
 *
 * Empty string values are treated as missing and produce a `ConfigError`.
 *
 * @example
 * ```ts
 * const program = Effect.withConfigProvider(ActionsConfigProvider)(
 *   Effect.config(Config.string("my-input"))
 * )
 * ```
 */
export const ActionsConfigProvider: ConfigProvider.ConfigProvider = ConfigProvider.fromFlat(
	ConfigProvider.makeFlat({
		patch: ConfigProviderPathPatch.empty,
		load: (path, primitive, _split = true) => {
			const mutablePath = [...path];
			const key = `INPUT_${mutablePath.join("_").replaceAll(" ", "_").toUpperCase()}`;
			const value = process.env[key];

			if (value === undefined || value === "") {
				return Effect.fail(
					ConfigError.MissingData(mutablePath, `Expected ${key} to be set in the process environment`),
				);
			}

			const parsed = primitive.parse(value);
			return Either.match(parsed, {
				onLeft: (e) => Effect.fail(ConfigError.prefixed(mutablePath)(e)),
				onRight: (a) => Effect.succeed(Arr.of(a)),
			});
		},
		enumerateChildren: (_path) => Effect.succeed(HashSet.empty<string>()),
	}),
);
