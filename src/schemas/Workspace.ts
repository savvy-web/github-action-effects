import { Schema } from "effect";

/**
 * Type of workspace/monorepo tool detected.
 *
 * @public
 */
export const WorkspaceType = Schema.Literal("single", "pnpm", "yarn", "npm", "bun");
export type WorkspaceType = typeof WorkspaceType.Type;

/**
 * Workspace root information.
 *
 * @public
 */
export const WorkspaceInfo = Schema.Struct({
	root: Schema.String,
	type: WorkspaceType,
	patterns: Schema.Array(Schema.String),
});
export type WorkspaceInfo = typeof WorkspaceInfo.Type;

/**
 * A workspace package entry.
 *
 * @public
 */
export const WorkspacePackage = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
	path: Schema.String,
	private: Schema.Boolean,
	dependencies: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type WorkspacePackage = typeof WorkspacePackage.Type;
