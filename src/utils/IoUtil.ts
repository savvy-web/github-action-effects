import { constants as fsConstants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { delimiter, isAbsolute, resolve, sep } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { IoError } from "../errors/IoError.js";

const isWindows = process.platform === "win32";

/**
 * Windows executable extensions from `PATHEXT`, lowercased. Empty on POSIX.
 */
const pathExtensions = (): ReadonlyArray<string> => {
	if (!isWindows) {
		return [];
	}
	const raw = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
	return raw
		.split(delimiter)
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.length > 0);
};

/**
 * Determine whether `info` (a stat result for `path`) marks an executable file.
 *
 * POSIX: a regular file with any execute bit set (`mode & 0o111`). The platform
 * `File.Info.mode` is the raw numeric stat mode, so the toolkit's bit math
 * applies directly.
 *
 * Windows: the file existing as a candidate with a `PATHEXT` extension is the
 * test (no execute bits), so any non-directory is treated as executable here;
 * the extension filtering happens in {@link candidatePaths}.
 */
const isExecutableInfo = (info: FileSystem.File.Info): boolean => {
	if (info.type === "Directory") {
		return false;
	}
	if (isWindows) {
		return true;
	}
	return (info.mode & 0o111) !== 0;
};

/**
 * Defensive fallback when the platform stat mode is unavailable or zero on a
 * POSIX system: ask the OS directly via `fs.access(path, X_OK)`.
 */
const accessExecutable = (path: string): Effect.Effect<boolean> =>
	Effect.promise(() =>
		fsAccess(path, fsConstants.X_OK).then(
			() => true,
			() => false,
		),
	);

/**
 * Build the list of candidate file paths to test for a given PATH directory and
 * tool name. On Windows, the bare candidate plus one per `PATHEXT` extension is
 * produced; on POSIX, just the bare candidate.
 */
const candidatePaths = (base: string): ReadonlyArray<string> => {
	const extensions = pathExtensions();
	if (extensions.length === 0) {
		return [base];
	}
	// If the base already ends with a known extension, test it as-is first.
	const lower = base.toLowerCase();
	const candidates: string[] = [];
	if (extensions.some((ext) => lower.endsWith(ext))) {
		candidates.push(base);
	}
	for (const ext of extensions) {
		candidates.push(`${base}${ext}`);
	}
	return candidates;
};

/**
 * Test a single candidate path: succeed with the path when it stats as an
 * executable file, otherwise `Option.none()`. Never fails.
 */
const checkCandidate = (fs: FileSystem.FileSystem, candidate: string): Effect.Effect<Option.Option<string>> =>
	fs.stat(candidate).pipe(
		Effect.flatMap((info) => {
			if (info.type === "Directory") {
				return Effect.succeed(Option.none<string>());
			}
			if (isExecutableInfo(info)) {
				return Effect.succeed(Option.some(candidate));
			}
			// Mode bits absent/zero on POSIX: fall back to a real X_OK probe.
			if (!isWindows && info.mode === 0) {
				return accessExecutable(candidate).pipe(
					Effect.map((ok) => (ok ? Option.some(candidate) : Option.none<string>())),
				);
			}
			return Effect.succeed(Option.none<string>());
		}),
		Effect.catchAll(() => Effect.succeed(Option.none<string>())),
	);

/**
 * Split `PATH` into directory segments, filtering out empty ones.
 */
const pathDirectories = (): ReadonlyArray<string> =>
	(process.env.PATH ?? "").split(delimiter).filter((d) => d.length > 0);

const containsSeparator = (tool: string): boolean => tool.includes("/") || (isWindows && tool.includes("\\"));

/**
 * Collect every executable match for `tool` across `PATH`. When `tool` already
 * contains a path separator it is resolved directly (with `PATHEXT` candidates
 * on Windows) and not searched on `PATH`.
 */
const collectMatches = (fs: FileSystem.FileSystem, tool: string): Effect.Effect<ReadonlyArray<string>> =>
	Effect.gen(function* () {
		const matches: string[] = [];

		const testBase = (base: string) =>
			Effect.gen(function* () {
				for (const candidate of candidatePaths(base)) {
					const hit = yield* checkCandidate(fs, candidate);
					if (Option.isSome(hit)) {
						matches.push(hit.value);
					}
				}
			});

		if (containsSeparator(tool)) {
			const absolute = isAbsolute(tool) ? tool : resolve(tool);
			yield* testBase(absolute);
			return matches;
		}

		for (const dir of pathDirectories()) {
			const base = dir.endsWith(sep) ? `${dir}${tool}` : `${dir}${sep}${tool}`;
			yield* testBase(base);
		}
		return matches;
	});

/**
 * Filesystem I/O lookup helpers — `@actions/io` `which` / `findInPath` parity.
 *
 * @remarks
 * These are pure path lookups against `process.env.PATH` and the injected
 * `FileSystem`. They are modeled as a namespace of `Effect`-returning functions
 * (like `RegistryClassifier` / `SemverResolver`) rather than a service, since
 * they carry no injected per-call state. They read `FileSystem` from context
 * (provided by `ActionsRuntime.Default`), so a real lookup needs no extra
 * wiring inside `Action.run`.
 *
 * `cp` / `mv` / `rmRF` / `mkdirP` are intentionally NOT provided here — they map
 * directly onto `@effect/platform` `FileSystem` (`copy` / `rename` / `remove` /
 * `makeDirectory`). See `docs/09-filesystem-io.md` for the substitution recipe.
 *
 * @public
 */
export const IoUtil = {
	/**
	 * Locate `tool` on `PATH`. Returns `Option.some(absolutePath)` for the first
	 * executable match, `Option.none()` when not found. On Windows, tries each
	 * `PATHEXT` extension. Maps `@actions/io`'s `which(tool, false)` → `""`.
	 */
	which: (tool: string): Effect.Effect<Option.Option<string>, IoError, FileSystem.FileSystem> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const matches = yield* collectMatches(fs, tool);
			return matches.length > 0 ? Option.some(matches[0]) : Option.none<string>();
		}),

	/**
	 * Strict variant of {@link IoUtil.which}. Fails with {@link IoError} when not
	 * found — mirrors `@actions/io` `which(tool, true)`, which throws.
	 */
	whichOrFail: (tool: string): Effect.Effect<string, IoError, FileSystem.FileSystem> =>
		IoUtil.which(tool).pipe(
			Effect.flatMap(
				Option.match({
					onNone: () =>
						Effect.fail(
							new IoError({
								operation: "which",
								tool,
								reason: `Unable to locate executable file: ${tool}. Please verify either the file path exists or the file can be found within a directory specified by the PATH environment variable.`,
							}),
						),
					onSome: (path) => Effect.succeed(path),
				}),
			),
		),

	/**
	 * Every executable match for `tool` on `PATH` (mirrors `findInPath`). Returns
	 * `[]` when none. When `tool` contains a path separator it is resolved
	 * directly rather than searched on `PATH`.
	 */
	findInPath: (tool: string): Effect.Effect<ReadonlyArray<string>, IoError, FileSystem.FileSystem> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			return yield* collectMatches(fs, tool);
		}),
} as const;
