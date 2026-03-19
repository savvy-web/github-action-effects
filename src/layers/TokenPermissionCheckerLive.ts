import { Effect, Layer } from "effect";
import { TokenPermissionError } from "../errors/TokenPermissionError.js";
import type {
	ExtraPermission,
	PermissionCheckResult,
	PermissionGap,
	PermissionLevel,
} from "../schemas/TokenPermission.js";
import { TokenPermissionChecker } from "../services/TokenPermissionChecker.js";

const levelValue = (level: string | undefined): number => {
	switch (level) {
		case "admin":
			return 3;
		case "write":
			return 2;
		case "read":
			return 1;
		default:
			return 0;
	}
};

const comparePermissions = (
	granted: Record<string, string>,
	requirements: Record<string, PermissionLevel>,
): PermissionCheckResult => {
	const missing: Array<PermissionGap> = [];
	const extra: Array<ExtraPermission> = [];

	// Check each required permission
	for (const [perm, required] of Object.entries(requirements)) {
		const grantedLevel = granted[perm];
		if (levelValue(grantedLevel) < levelValue(required)) {
			missing.push({
				permission: perm,
				required,
				granted: grantedLevel as PermissionLevel | undefined,
			});
		}
	}

	// Check for extra permissions not in requirements
	for (const [perm, level] of Object.entries(granted)) {
		if (!(perm in requirements)) {
			extra.push({ permission: perm, level: level as PermissionLevel });
		}
	}

	return {
		granted: granted as Record<string, PermissionLevel>,
		required: requirements,
		missing,
		extra,
		satisfied: missing.length === 0,
	};
};

const toErrorMissing = (
	gaps: ReadonlyArray<PermissionGap>,
): Array<{ permission: string; required: string; granted?: string }> =>
	gaps.map((m) => {
		const entry: { permission: string; required: string; granted?: string } = {
			permission: m.permission,
			required: m.required,
		};
		if (m.granted !== undefined) {
			entry.granted = m.granted;
		}
		return entry;
	});

/**
 * Live implementation of TokenPermissionChecker.
 *
 * Constructed with a granted permissions record (typically from InstallationToken.permissions).
 *
 * @public
 */
export const TokenPermissionCheckerLive = (permissions: Record<string, string>): Layer.Layer<TokenPermissionChecker> =>
	Layer.succeed(TokenPermissionChecker, {
		check: (requirements) => Effect.sync(() => comparePermissions(permissions, requirements)),

		assertSufficient: (requirements) =>
			Effect.gen(function* () {
				const result = comparePermissions(permissions, requirements);
				if (!result.satisfied) {
					return yield* Effect.fail(
						new TokenPermissionError({
							missing: toErrorMissing(result.missing),
							reason: `Insufficient permissions: ${result.missing.map((m) => `${m.permission} (need ${m.required}, have ${m.granted ?? "none"})`).join(", ")}`,
						}),
					);
				}
				return result;
			}),

		assertExact: (requirements) =>
			Effect.gen(function* () {
				const result = comparePermissions(permissions, requirements);
				if (!result.satisfied) {
					return yield* Effect.fail(
						new TokenPermissionError({
							missing: toErrorMissing(result.missing),
							reason: `Insufficient permissions: ${result.missing.map((m) => `${m.permission} (need ${m.required}, have ${m.granted ?? "none"})`).join(", ")}`,
						}),
					);
				}
				if (result.extra.length > 0) {
					return yield* Effect.fail(
						new TokenPermissionError({
							missing: [],
							extra: result.extra.map((e) => ({
								permission: e.permission,
								level: e.level,
							})),
							reason: `Over-permissioned token: ${result.extra.map((e) => `${e.permission}:${e.level}`).join(", ")}`,
						}),
					);
				}
				return result;
			}),

		warnOverPermissioned: (requirements) => Effect.sync(() => comparePermissions(permissions, requirements)),
	});
