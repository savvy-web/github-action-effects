import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { TokenPermissionCheckerTest } from "../layers/TokenPermissionCheckerTest.js";
import { TokenPermissionChecker } from "./TokenPermissionChecker.js";

const provide = <A, E>(
	state: ReturnType<typeof TokenPermissionCheckerTest.empty>,
	effect: Effect.Effect<A, E, TokenPermissionChecker>,
) => Effect.provide(effect, TokenPermissionCheckerTest.layer(state));

const run = <A, E>(
	state: ReturnType<typeof TokenPermissionCheckerTest.empty>,
	effect: Effect.Effect<A, E, TokenPermissionChecker>,
) => Effect.runPromise(provide(state, effect));

const runExit = <A, E>(
	state: ReturnType<typeof TokenPermissionCheckerTest.empty>,
	effect: Effect.Effect<A, E, TokenPermissionChecker>,
) => Effect.runPromise(Effect.exit(provide(state, effect)));

const check = (requirements: Record<string, "read" | "write" | "admin">) =>
	Effect.flatMap(TokenPermissionChecker, (svc) => svc.check(requirements));

const assertSufficient = (requirements: Record<string, "read" | "write" | "admin">) =>
	Effect.flatMap(TokenPermissionChecker, (svc) => svc.assertSufficient(requirements));

const assertExact = (requirements: Record<string, "read" | "write" | "admin">) =>
	Effect.flatMap(TokenPermissionChecker, (svc) => svc.assertExact(requirements));

const warnOverPermissioned = (requirements: Record<string, "read" | "write" | "admin">) =>
	Effect.flatMap(TokenPermissionChecker, (svc) => svc.warnOverPermissioned(requirements));

describe("TokenPermissionChecker", () => {
	describe("check", () => {
		it("returns satisfied=true when all permissions met", async () => {
			const state: ReturnType<typeof TokenPermissionCheckerTest.empty> = {
				grantedPermissions: { contents: "write", issues: "read" },
				checkCalls: [],
			};
			const result = await run(state, check({ contents: "write", issues: "read" }));
			expect(result.satisfied).toBe(true);
			expect(result.missing).toHaveLength(0);
		});

		it("returns missing when permission insufficient", async () => {
			const state: ReturnType<typeof TokenPermissionCheckerTest.empty> = {
				grantedPermissions: { contents: "read" },
				checkCalls: [],
			};
			const result = await run(state, check({ contents: "write" }));
			expect(result.satisfied).toBe(false);
			expect(result.missing).toHaveLength(1);
			expect(result.missing[0]).toEqual({
				permission: "contents",
				required: "write",
				granted: "read",
			});
		});

		it("returns extra when token has unrequested permissions", async () => {
			const state: ReturnType<typeof TokenPermissionCheckerTest.empty> = {
				grantedPermissions: { contents: "write", issues: "read", actions: "admin" },
				checkCalls: [],
			};
			const result = await run(state, check({ contents: "write" }));
			expect(result.satisfied).toBe(true);
			expect(result.extra).toHaveLength(2);
			expect(result.extra.map((e) => e.permission).sort()).toEqual(["actions", "issues"]);
		});
	});

	describe("assertSufficient", () => {
		it("succeeds when satisfied", async () => {
			const state: ReturnType<typeof TokenPermissionCheckerTest.empty> = {
				grantedPermissions: { contents: "admin" },
				checkCalls: [],
			};
			const result = await run(state, assertSufficient({ contents: "write" }));
			expect(result.satisfied).toBe(true);
		});

		it("fails when missing", async () => {
			const state: ReturnType<typeof TokenPermissionCheckerTest.empty> = {
				grantedPermissions: { contents: "read" },
				checkCalls: [],
			};
			const exit = await runExit(state, assertSufficient({ contents: "write" }));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(String(exit.cause)).toContain("TokenPermissionError");
			}
		});
	});

	describe("assertExact", () => {
		it("succeeds when exact match", async () => {
			const state: ReturnType<typeof TokenPermissionCheckerTest.empty> = {
				grantedPermissions: { contents: "write" },
				checkCalls: [],
			};
			const result = await run(state, assertExact({ contents: "write" }));
			expect(result.satisfied).toBe(true);
			expect(result.extra).toHaveLength(0);
		});

		it("fails when extra permissions present", async () => {
			const state: ReturnType<typeof TokenPermissionCheckerTest.empty> = {
				grantedPermissions: { contents: "write", issues: "read" },
				checkCalls: [],
			};
			const exit = await runExit(state, assertExact({ contents: "write" }));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(String(exit.cause)).toContain("TokenPermissionError");
			}
		});
	});

	describe("warnOverPermissioned", () => {
		it("never fails and returns result with extras", async () => {
			const state: ReturnType<typeof TokenPermissionCheckerTest.empty> = {
				grantedPermissions: { contents: "write", issues: "admin", actions: "read" },
				checkCalls: [],
			};
			const result = await run(state, warnOverPermissioned({ contents: "write" }));
			expect(result.satisfied).toBe(true);
			expect(result.extra).toHaveLength(2);
		});
	});
});
