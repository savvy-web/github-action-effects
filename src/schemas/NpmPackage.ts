import { Schema } from "effect";

/**
 * Schema for npm package metadata.
 *
 * @public
 */
export const NpmPackageInfo = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
	distTags: Schema.Record({ key: Schema.String, value: Schema.String }),
	integrity: Schema.UndefinedOr(Schema.String),
	tarball: Schema.UndefinedOr(Schema.String),
});
export type NpmPackageInfo = typeof NpmPackageInfo.Type;
