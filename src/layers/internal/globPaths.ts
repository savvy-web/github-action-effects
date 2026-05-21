import { existsSync, globSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Check whether a path contains glob metacharacters (`*`, `?`, `[`).
 *
 * @internal
 */
export const hasGlobChars = (p: string): boolean => /[*?[]/.test(p);

/**
 * Resolve a tilde prefix (`~` or `~/`) to the user's home directory.
 *
 * Honors `process.env.HOME` first (so tests can stub it), falling back to
 * `os.homedir()`.
 *
 * @internal
 */
export const expandTilde = (raw: string): string => {
	const home = process.env.HOME || homedir();
	return raw.startsWith("~/") ? join(home, raw.slice(2)) : raw === "~" ? home : raw;
};

/**
 * Resolve paths before passing to a downstream consumer (tar, hashing, etc.):
 * 1. Expand `~` prefix to the user's home directory
 * 2. Expand glob patterns (both relative and absolute) via `node:fs.globSync`
 * 3. Filter out paths that don't exist on disk
 * 4. Deduplicate entries where a parent directory already covers a child
 *
 * This is the shared source of truth for path resolution used by both
 * `ActionCacheLive` (archive creation) and `GlobLive` (glob/hashFiles).
 *
 * @internal
 */
export const resolvePaths = (paths: ReadonlyArray<string>): ReadonlyArray<string> => {
	const expanded: string[] = [];

	for (const raw of paths) {
		// Step 1: Resolve tilde
		const p = expandTilde(raw);

		// Step 2: Expand globs or keep literal paths
		if (hasGlobChars(p)) {
			expanded.push(...globSync(p));
		} else {
			expanded.push(p);
		}
	}

	// Step 3: Filter non-existent paths
	const existing = expanded.filter((p) => existsSync(p));

	// Step 4: Deduplicate — remove entries where a parent directory is already listed
	// Sort shortest-first so parents come before children
	const sorted = [...existing].sort((a, b) => a.length - b.length);
	const result: string[] = [];
	for (const p of sorted) {
		const coveredByParent = result.some((parent) => p.startsWith(`${parent}/`));
		if (!coveredByParent) {
			result.push(p);
		}
	}

	return result;
};
