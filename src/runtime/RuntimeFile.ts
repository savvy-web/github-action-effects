import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { RuntimeEnvironmentError } from "../errors/RuntimeEnvironmentError.js";

/**
 * Formats a key-value pair for appending to a GitHub Actions environment file.
 *
 * Single-line values use `key=value\n`.
 * Multiline values use the delimiter format:
 * ```
 * key<<ghadelimiter_<uuid>
 * value
 * ghadelimiter_<uuid>
 * ```
 *
 * @param name - The variable name
 * @param value - The variable value
 * @returns Formatted string ready to append to the file
 */
export function prepareValue(name: string, value: string): string {
	if (!value.includes("\n")) {
		return `${name}=${value}\n`;
	}
	const delimiter = `ghadelimiter_${crypto.randomUUID()}`;
	return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}

/**
 * Reads the file path from an environment variable, formats the key-value pair,
 * and appends it to the file using `FileSystem`.
 *
 * @param envVar - The environment variable holding the file path (e.g. "GITHUB_OUTPUT")
 * @param name - The variable name to write
 * @param value - The variable value to write
 * @returns An Effect that appends to the file, failing with `RuntimeEnvironmentError` if the env var is unset
 */
export const append = (
	envVar: string,
	name: string,
	value: string,
): Effect.Effect<void, RuntimeEnvironmentError, FileSystem.FileSystem> =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => {
		const filePath = process.env[envVar];
		if (filePath === undefined) {
			return Effect.fail(
				new RuntimeEnvironmentError({
					variable: envVar,
					message: `Environment variable ${envVar} is not set`,
				}),
			);
		}
		const content = prepareValue(name, value);
		return fs.writeFileString(filePath, content, { flag: "a" }).pipe(
			Effect.mapError(
				(error) =>
					new RuntimeEnvironmentError({
						variable: envVar,
						message: `Failed to write to file at ${filePath}: ${error.description ?? String(error)}`,
					}),
			),
		);
	});
