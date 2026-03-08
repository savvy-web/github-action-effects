import { Effect } from "effect";
import semver from "semver";
import { SemverResolverError } from "../errors/SemverResolverError.js";

/**
 * Namespace for semver resolution operations.
 *
 * Wraps the `semver` npm package with Effect error handling.
 *
 * @public
 */
export const SemverResolver = {
	/**
	 * Compare two semver versions.
	 * Returns -1 if a is less than b, 0 if equal, 1 if a is greater than b.
	 */
	compare: (a: string, b: string): Effect.Effect<-1 | 0 | 1, SemverResolverError> =>
		Effect.try({
			try: () => {
				const result = semver.compare(a, b);
				return result as -1 | 0 | 1;
			},
			catch: () =>
				new SemverResolverError({
					operation: "compare",
					version: `${a} vs ${b}`,
					reason: "Invalid semver version",
				}),
		}),

	/**
	 * Check whether a version satisfies a semver range.
	 */
	satisfies: (version: string, range: string): Effect.Effect<boolean, SemverResolverError> =>
		Effect.try({
			try: () => semver.satisfies(version, range),
			catch: () =>
				new SemverResolverError({
					operation: "satisfies",
					version,
					reason: `Invalid version or range "${range}"`,
				}),
		}),

	/**
	 * Find the highest version in an array that satisfies a range.
	 */
	latestInRange: (versions: Array<string>, range: string): Effect.Effect<string, SemverResolverError> =>
		Effect.try({
			try: () => {
				const result = semver.maxSatisfying(versions, range);
				if (result === null) {
					throw new Error("No version satisfies range");
				}
				return result;
			},
			catch: (e) =>
				new SemverResolverError({
					operation: "latestInRange",
					version: range,
					reason: e instanceof Error ? e.message : "Invalid input",
				}),
		}),

	/**
	 * Increment a version by a given bump type.
	 */
	increment: (
		version: string,
		bump: "major" | "minor" | "patch" | "prerelease",
	): Effect.Effect<string, SemverResolverError> =>
		Effect.try({
			try: () => {
				const result = semver.inc(version, bump);
				if (result === null) {
					throw new Error(`Cannot increment "${version}" by ${bump}`);
				}
				return result;
			},
			catch: (e) =>
				new SemverResolverError({
					operation: "increment",
					version,
					reason: e instanceof Error ? e.message : "Invalid version",
				}),
		}),

	/**
	 * Parse a version string into its component parts.
	 */
	parse: (
		version: string,
	): Effect.Effect<
		{
			major: number;
			minor: number;
			patch: number;
			prerelease?: string;
			build?: string;
		},
		SemverResolverError
	> =>
		Effect.try({
			try: () => {
				const parsed = semver.parse(version);
				if (!parsed) {
					throw new Error(`Invalid semver: "${version}"`);
				}
				return {
					major: parsed.major,
					minor: parsed.minor,
					patch: parsed.patch,
					...(parsed.prerelease.length > 0 ? { prerelease: parsed.prerelease.join(".") } : {}),
					...(parsed.build.length > 0 ? { build: parsed.build.join(".") } : {}),
				};
			},
			catch: (e) =>
				new SemverResolverError({
					operation: "parse",
					version,
					reason: e instanceof Error ? e.message : "Invalid version",
				}),
		}),
} as const;
