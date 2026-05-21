import { createHash } from "node:crypto";
import { createReadStream, globSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Effect, Layer, Option } from "effect";
import { GlobError } from "../errors/GlobError.js";
import { Glob } from "../services/Glob.js";
import { expandTilde } from "./internal/globPaths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedPatterns {
	readonly includes: ReadonlyArray<string>;
	readonly excludes: ReadonlyArray<string>;
}

/**
 * Parse a newline- or comma-separated patterns string into include/exclude
 * lists, mirroring `@actions/glob`'s pattern semantics:
 * - lines split on `\n`, `\r\n` and `,`
 * - blank lines and `#` comments are ignored
 * - lines starting with `!` are exclude patterns
 * - `~` / `~/` is expanded to the user's home directory
 */
const parsePatterns = (patterns: string): ParsedPatterns => {
	const includes: string[] = [];
	const excludes: string[] = [];
	for (const rawLine of patterns.split(/[\n,]/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}
		if (line.startsWith("!")) {
			excludes.push(expandTilde(line.slice(1).trim()));
		} else {
			includes.push(expandTilde(line));
		}
	}
	return { includes, excludes };
};

/**
 * Resolve include/exclude patterns into a sorted, deduplicated list of
 * absolute paths. Shared by `glob` and `hashFiles` so the file ordering is
 * identical between them.
 */
const resolveMatches = (patterns: string): ReadonlyArray<string> => {
	const { includes, excludes } = parsePatterns(patterns);

	const matched = new Set<string>();
	for (const include of includes) {
		for (const m of globSync(include, { exclude: excludes.length > 0 ? [...excludes] : undefined })) {
			matched.add(resolve(m));
		}
	}

	// `globSync`'s `exclude` is matched against the relative entry, so also drop
	// any match whose resolved absolute path matches an exclude glob result.
	if (excludes.length > 0) {
		const excluded = new Set<string>();
		for (const exclude of excludes) {
			for (const m of globSync(exclude)) {
				excluded.add(resolve(m));
			}
		}
		for (const e of excluded) {
			matched.delete(e);
		}
	}

	return [...matched].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
};

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

/**
 * Live implementation of {@link Glob} using `node:fs.globSync`, `node:crypto`
 * and `node:fs.createReadStream`. No dependency on `@actions/glob`.
 *
 * @public
 */
export const GlobLive: Layer.Layer<Glob> = Layer.succeed(Glob, {
	glob: (patterns, _options) =>
		Effect.try({
			try: () => resolveMatches(patterns),
			catch: (error) =>
				new GlobError({
					operation: "glob",
					patterns,
					reason: error instanceof Error ? error.message : String(error),
				}),
		}),

	hashFiles: (patterns, options) =>
		Effect.tryPromise({
			try: async (): Promise<Option.Option<string>> => {
				const workspace = options?.workspace ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
				const prefix = `${workspace}${sep}`;
				const files = resolveMatches(patterns);

				const result = createHash("sha256");
				let matched = false;
				for (const file of files) {
					// Skip files outside the workspace root (relative-path safety),
					// matching @actions/glob's hashFiles behavior.
					if (!file.startsWith(prefix)) {
						continue;
					}
					const fileHash = createHash("sha256");
					await pipeline(createReadStream(file), fileHash);
					// BINARY digest, not hex — fed into the accumulating hash.
					result.write(fileHash.digest());
					matched = true;
				}
				return matched ? Option.some(result.digest("hex")) : Option.none();
			},
			catch: (error) =>
				new GlobError({
					operation: "hashFiles",
					patterns,
					reason: error instanceof Error ? error.message : String(error),
				}),
		}),
});
