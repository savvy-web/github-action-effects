import { Config, ConfigError, Either } from "effect";

/**
 * GitHub-faithful action input helpers expressed as Effect `Config` combinators.
 *
 * @remarks
 * These read through the same {@link ActionsConfigProvider} as `Config.string`,
 * so they compose with `Config.withDefault`, `Config.option`, etc. The key
 * difference from Effect's built-in `Config.boolean` is the accepted truth set:
 * GitHub Actions follows the YAML 1.2 "Core Schema" exactly, whereas
 * `Config.boolean` also accepts JS-flavored values like `yes`/`on`/`1`.
 *
 * @example
 * ```ts
 * import { ActionInput } from "@savvy-web/github-action-effects"
 *
 * const dryRun = yield* ActionInput.boolean("dry-run")
 * const paths = yield* ActionInput.multiline("paths")
 * ```
 *
 * @public
 */
export const ActionInput = {
	/**
	 * YAML 1.2 "Core Schema" boolean input, matching `@actions/core.getBooleanInput`.
	 *
	 * @remarks
	 * Accepts ONLY `true | True | TRUE` (→ `true`) and `false | False | FALSE`
	 * (→ `false`). Surrounding whitespace is trimmed before the comparison
	 * (matching the toolkit, which trims by default). Everything else — including
	 * Effect's `Config.boolean` extras `yes`/`on`/`1`/`no`/`off`/`0` and
	 * mixed-case variants like `tRue` — fails with `ConfigError.InvalidData`.
	 *
	 * Prefer this over `Config.boolean` for GitHub-faithful semantics:
	 * `Config.boolean("dry-run")` would silently accept `dry-run: yes` (which
	 * GitHub's own composite-action runtime rejects) and reject `dry-run: True`
	 * (which GitHub accepts).
	 *
	 * @param name - The input name (read as `INPUT_<NAME>`).
	 */
	boolean: (name: string): Config.Config<boolean> =>
		Config.string(name).pipe(
			Config.mapOrFail((raw) => {
				const val = raw.trim();
				if (val === "true" || val === "True" || val === "TRUE") {
					return Either.right(true);
				}
				if (val === "false" || val === "False" || val === "FALSE") {
					return Either.right(false);
				}
				return Either.left(
					ConfigError.InvalidData(
						[name],
						`Input does not meet YAML 1.2 "Core Schema" specification: ${name}\n` +
							"Support boolean input list: `true | True | TRUE | false | False | FALSE`",
					),
				);
			}),
		),

	/**
	 * Multiline input, matching `@actions/core.getMultilineInput`.
	 *
	 * @remarks
	 * Splits the raw value on `\n`, drops empty lines (after the split, before
	 * trimming), and trims each remaining line. A missing input is a
	 * `ConfigError.MissingData` (matching `Config.string`); combine with
	 * `Config.withDefault([])` for an empty-when-absent array.
	 *
	 * @param name - The input name (read as `INPUT_<NAME>`).
	 */
	multiline: (name: string): Config.Config<ReadonlyArray<string>> =>
		Config.string(name).pipe(
			Config.map((raw) =>
				raw
					.split("\n")
					.filter((line) => line !== "")
					.map((line) => line.trim()),
			),
		),
} as const;
