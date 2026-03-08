import type { Effect } from "effect";
import { Context } from "effect";
import type { TokenPermissionError } from "../errors/TokenPermissionError.js";
import type { PermissionCheckResult, PermissionLevel } from "../schemas/TokenPermission.js";

/**
 * Service interface for checking GitHub token permissions.
 *
 * Provides three enforcement modes:
 * - `check`: Compare granted vs required, return result
 * - `assertSufficient`: Fail if any required permissions are missing
 * - `assertExact`: Fail if any missing OR extra permissions
 * - `warnOverPermissioned`: Log warnings for extras, never fail
 *
 * @public
 */
export interface TokenPermissionChecker {
	/** Compare granted permissions against requirements and return the result. */
	readonly check: (
		requirements: Record<string, PermissionLevel>,
	) => Effect.Effect<PermissionCheckResult, TokenPermissionError>;

	/** Fail if any required permissions are missing. */
	readonly assertSufficient: (
		requirements: Record<string, PermissionLevel>,
	) => Effect.Effect<PermissionCheckResult, TokenPermissionError>;

	/** Fail if any required permissions are missing OR extra permissions are present. */
	readonly assertExact: (
		requirements: Record<string, PermissionLevel>,
	) => Effect.Effect<PermissionCheckResult, TokenPermissionError>;

	/** Log warnings for over-scoped permissions; never fails. */
	readonly warnOverPermissioned: (
		requirements: Record<string, PermissionLevel>,
	) => Effect.Effect<PermissionCheckResult, never>;
}

/**
 * TokenPermissionChecker tag for dependency injection.
 *
 * @public
 */
export const TokenPermissionChecker = Context.GenericTag<TokenPermissionChecker>("TokenPermissionChecker");
