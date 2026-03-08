import { Schema } from "effect";

/**
 * Supported package manager names.
 *
 * @public
 */
export const PackageManagerName = Schema.Literal("npm", "pnpm", "yarn", "bun", "deno");

/**
 * Type for supported package manager names.
 *
 * @public
 */
export type PackageManagerName = typeof PackageManagerName.Type;

/**
 * Information about a detected package manager.
 *
 * @public
 */
export const PackageManagerInfo = Schema.Struct({
	name: PackageManagerName,
	version: Schema.String,
	lockfile: Schema.UndefinedOr(Schema.String),
});

/**
 * Type for package manager info.
 *
 * @public
 */
export type PackageManagerInfo = typeof PackageManagerInfo.Type;
