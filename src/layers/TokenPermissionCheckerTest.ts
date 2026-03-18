import { Effect, Layer } from "effect";
import { TokenPermissionError } from "../errors/TokenPermissionError.js";
import type {
	ExtraPermission,
	PermissionCheckResult,
	PermissionGap,
	PermissionLevel,
} from "../schemas/TokenPermission.js";
import { TokenPermissionChecker } from "../services/TokenPermissionChecker.js";

/**
 * Test state for TokenPermissionChecker.
 *
 * @public
 */
export interface TokenPermissionCheckerTestState {
	readonly grantedPermissions: Record<string, string>;
	readonly checkCalls: Array<Record<string, PermissionLevel>>;
}

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

const makeTestTokenPermissionChecker = (
	state: TokenPermissionCheckerTestState,
): typeof TokenPermissionChecker.Service => ({
	check: (requirements) =>
		Effect.sync(() => {
			state.checkCalls.push(requirements);
			return comparePermissions(state.grantedPermissions, requirements);
		}),

	assertSufficient: (requirements) =>
		Effect.gen(function* () {
			state.checkCalls.push(requirements);
			const result = comparePermissions(state.grantedPermissions, requirements);
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
			state.checkCalls.push(requirements);
			const result = comparePermissions(state.grantedPermissions, requirements);
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

	warnOverPermissioned: (requirements) =>
		Effect.sync(() => {
			state.checkCalls.push(requirements);
			return comparePermissions(state.grantedPermissions, requirements);
		}),
});

/**
 * Test implementation for TokenPermissionChecker.
 *
 * @public
 */
export const TokenPermissionCheckerTest = {
	/** Create test layer with configured state. */
	layer: (state: TokenPermissionCheckerTestState): Layer.Layer<TokenPermissionChecker> =>
		Layer.succeed(TokenPermissionChecker, makeTestTokenPermissionChecker(state)),

	/** Create a fresh test state with no permissions. */
	empty: (): TokenPermissionCheckerTestState => ({
		grantedPermissions: {},
		checkCalls: [],
	}),
} as const;
