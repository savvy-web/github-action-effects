import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { GlobError } from "../errors/GlobError.js";

/**
 * Options mirroring `@actions/glob`'s `GlobOptions` (the documented subset).
 *
 * @remarks
 * `node:fs.globSync` has a narrower option surface than `@actions/glob`. The
 * options here are accepted for API parity; those `globSync` does not support
 * natively are documented no-ops rather than silently dropped behavior:
 * `followSymbolicLinks`, `implicitDescendants`, `matchDirectories` and
 * `omitBrokenSymbolicLinks` are not enforced by the underlying `globSync` walk.
 *
 * @public
 */
export interface GlobOptions {
	/**
	 * Follow symlinks while walking. Default true (matches `@actions/glob`).
	 *
	 * @remarks No-op: `node:fs.globSync` exposes no symlink-follow control;
	 * symlinks are always followed.
	 */
	readonly followSymbolicLinks?: boolean;
	/**
	 * Expand a directory match to its descendants. Default true.
	 *
	 * @remarks No-op: not enforced by `node:fs.globSync`.
	 */
	readonly implicitDescendants?: boolean;
	/**
	 * Include directories themselves in results. Default false.
	 *
	 * @remarks No-op: not enforced by `node:fs.globSync`.
	 */
	readonly matchDirectories?: boolean;
	/**
	 * Suppress errors on broken symlinks. Default true.
	 *
	 * @remarks No-op: not enforced by `node:fs.globSync`.
	 */
	readonly omitBrokenSymbolicLinks?: boolean;
}

/**
 * Options for {@link Glob.hashFiles}.
 *
 * @public
 */
export interface HashFilesOptions {
	/**
	 * Workspace root; files outside it are skipped. Defaults to
	 * `process.env.GITHUB_WORKSPACE`, matching `@actions/glob`'s `hashFiles`.
	 */
	readonly workspace?: string;
	/**
	 * Follow symlinks while walking. Default true.
	 *
	 * @remarks No-op: `node:fs.globSync` exposes no symlink-follow control;
	 * symlinks are always followed.
	 */
	readonly followSymbolicLinks?: boolean;
}

/**
 * Service for resolving glob patterns and computing `@actions/glob`-compatible
 * file hashes.
 *
 * @remarks
 * `GlobLive` wraps `node:fs.globSync`; `GlobTest` is an in-memory namespace
 * layer. No dependency on `@actions/glob`.
 *
 * @public
 */
export class Glob extends Context.Tag("github-action-effects/Glob")<
	Glob,
	{
		/**
		 * Resolve newline- (or comma-) separated glob patterns to absolute paths,
		 * in deterministic lexicographically-sorted order. Honors `!` exclude
		 * patterns and `~` HOME expansion, and skips blank lines and `#` comments.
		 * Returns `[]` when nothing matches.
		 */
		readonly glob: (patterns: string, options?: GlobOptions) => Effect.Effect<ReadonlyArray<string>, GlobError>;

		/**
		 * Compute the `@actions/glob`-compatible SHA-256 hash-of-hashes over the
		 * files matched by `patterns`: each matched file is streamed through its
		 * own SHA-256, and the binary digests are fed — in sorted glob order —
		 * into one accumulating SHA-256 whose final hex digest is returned.
		 *
		 * Files outside the workspace root are skipped. Returns `Option.none()`
		 * when no file matched (the toolkit returns `""`; recover that verbatim
		 * with `Option.getOrElse(() => "")`).
		 */
		readonly hashFiles: (
			patterns: string,
			options?: HashFilesOptions,
		) => Effect.Effect<Option.Option<string>, GlobError>;
	}
>() {}
