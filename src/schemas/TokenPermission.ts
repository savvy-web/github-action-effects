import { Schema } from "effect";

/**
 * Permission level for a GitHub token scope.
 *
 * @public
 */
export const PermissionLevel = Schema.Literal("read", "write", "admin");

/**
 * Decoded type for PermissionLevel.
 *
 * @public
 */
export type PermissionLevel = typeof PermissionLevel.Type;

/**
 * A missing or insufficient permission.
 *
 * @public
 */
export const PermissionGap = Schema.Struct({
	permission: Schema.String,
	required: PermissionLevel,
	granted: Schema.UndefinedOr(PermissionLevel),
});

/**
 * Decoded type for PermissionGap.
 *
 * @public
 */
export type PermissionGap = typeof PermissionGap.Type;

/**
 * A permission granted but not required.
 *
 * @public
 */
export const ExtraPermission = Schema.Struct({
	permission: Schema.String,
	level: PermissionLevel,
});

/**
 * Decoded type for ExtraPermission.
 *
 * @public
 */
export type ExtraPermission = typeof ExtraPermission.Type;

/**
 * Result of a permission check comparing granted vs required.
 *
 * @public
 */
export const PermissionCheckResult = Schema.Struct({
	granted: Schema.Record({ key: Schema.String, value: PermissionLevel }),
	required: Schema.Record({ key: Schema.String, value: PermissionLevel }),
	missing: Schema.Array(PermissionGap),
	extra: Schema.Array(ExtraPermission),
	satisfied: Schema.Boolean,
});

/**
 * Decoded type for PermissionCheckResult.
 *
 * @public
 */
export type PermissionCheckResult = typeof PermissionCheckResult.Type;
