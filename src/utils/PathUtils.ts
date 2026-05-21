import { sep } from "node:path";

/**
 * Pure path-normalization helpers, matching `@actions/core` path utilities.
 *
 * @example
 * ```ts
 * import { PathUtils } from "@savvy-web/github-action-effects"
 *
 * PathUtils.toPosixPath("a\\b") // "a/b"
 * ```
 *
 * @public
 */
export const PathUtils = {
	/** Normalize backslashes to forward slashes. Matches `@actions/core.toPosixPath`. */
	toPosixPath: (pth: string): string => pth.replace(/\\/g, "/"),

	/** Normalize forward slashes to backslashes. Matches `@actions/core.toWin32Path`. */
	toWin32Path: (pth: string): string => pth.replace(/\//g, "\\"),

	/** Normalize both separators to the platform separator. Matches `@actions/core.toPlatformPath`. */
	toPlatformPath: (pth: string): string => pth.replace(/[/\\]/g, sep),
} as const;
