import { Effect, Option } from "effect";
import { Range, SemVer } from "semver-effect";
import { SemverResolverError } from "../errors/SemverResolverError.js";

/**
 * Namespace for semver resolution operations.
 *
 * Wraps `semver-effect` with unified {@link SemverResolverError} error handling.
 *
 * @public
 */
export const SemverResolver = {
	/**
	 * Compare two semver versions.
	 * Returns -1 if a is less than b, 0 if equal, 1 if a is greater than b.
	 */
	compare: (a: string, b: string): Effect.Effect<-1 | 0 | 1, SemverResolverError> =>
		Effect.gen(function* () {
			const va = yield* SemVer.fromString(a);
			const vb = yield* SemVer.fromString(b);
			return SemVer.compare(va, vb);
		}).pipe(
			Effect.mapError(
				() =>
					new SemverResolverError({
						operation: "compare",
						version: `${a} vs ${b}`,
						reason: "Invalid semver version",
					}),
			),
		),

	/**
	 * Check whether a version satisfies a semver range.
	 */
	satisfies: (version: string, range: string): Effect.Effect<boolean, SemverResolverError> =>
		Effect.gen(function* () {
			const v = yield* SemVer.fromString(version);
			const r = yield* Range.fromString(range);
			return Range.satisfies(v, r);
		}).pipe(
			Effect.mapError(
				() =>
					new SemverResolverError({
						operation: "satisfies",
						version,
						reason: `Invalid version or range "${range}"`,
					}),
			),
		),

	/**
	 * Find the highest version in an array that satisfies a range.
	 */
	latestInRange: (versions: Array<string>, range: string): Effect.Effect<string, SemverResolverError> =>
		Effect.gen(function* () {
			const parsed = yield* Effect.all(versions.map(SemVer.fromString)).pipe(
				Effect.mapError(
					() =>
						new SemverResolverError({
							operation: "latestInRange",
							version: range,
							reason: "Invalid input",
						}),
				),
			);
			const r = yield* Range.fromString(range).pipe(
				Effect.mapError(
					() =>
						new SemverResolverError({
							operation: "latestInRange",
							version: range,
							reason: "Invalid input",
						}),
				),
			);
			const result = Range.maxSatisfying(parsed, r);
			return yield* Option.match(result, {
				onNone: () =>
					Effect.fail(
						new SemverResolverError({
							operation: "latestInRange",
							version: range,
							reason: "No version satisfies range",
						}),
					),
				onSome: (v) => Effect.succeed(v.toString()),
			});
		}),

	/**
	 * Increment a version by a given bump type.
	 */
	increment: (
		version: string,
		bump: "major" | "minor" | "patch" | "prerelease",
	): Effect.Effect<string, SemverResolverError> =>
		SemVer.fromString(version).pipe(
			Effect.map((v) => SemVer.bump[bump](v).toString()),
			Effect.mapError(
				() =>
					new SemverResolverError({
						operation: "increment",
						version,
						reason: `Cannot increment "${version}" by ${bump}`,
					}),
			),
		),

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
		SemVer.fromString(version).pipe(
			Effect.map((v) => ({
				major: v.major,
				minor: v.minor,
				patch: v.patch,
				...(v.prerelease.length > 0 ? { prerelease: v.prerelease.join(".") } : {}),
				...(v.build.length > 0 ? { build: v.build.join(".") } : {}),
			})),
			Effect.mapError(
				() =>
					new SemverResolverError({
						operation: "parse",
						version,
						reason: `Invalid semver: "${version}"`,
					}),
			),
		),
} as const;
