import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import type { TokenPermissionError } from "../errors/TokenPermissionError.js";
import { TokenPermissionChecker } from "../services/TokenPermissionChecker.js";
import { TokenPermissionCheckerLive } from "./TokenPermissionCheckerLive.js";

const extractError = (exit: Exit.Exit<unknown, TokenPermissionError>): TokenPermissionError => {
	if (!Exit.isFailure(exit)) throw new Error("Expected failure");
	const failure = Cause.failureOption(exit.cause);
	if (failure._tag !== "Some") throw new Error("Expected fail cause");
	return failure.value;
};

const provide = <A, E>(permissions: Record<string, string>, effect: Effect.Effect<A, E, TokenPermissionChecker>) =>
	Effect.provide(effect, TokenPermissionCheckerLive(permissions));

const run = <A, E>(permissions: Record<string, string>, effect: Effect.Effect<A, E, TokenPermissionChecker>) =>
	Effect.runPromise(provide(permissions, effect));

const runExit = <A, E>(permissions: Record<string, string>, effect: Effect.Effect<A, E, TokenPermissionChecker>) =>
	Effect.runPromise(Effect.exit(provide(permissions, effect)));

const check = (requirements: Record<string, "read" | "write" | "admin">) =>
	Effect.flatMap(TokenPermissionChecker, (svc) => svc.check(requirements));

const assertSufficient = (requirements: Record<string, "read" | "write" | "admin">) =>
	Effect.flatMap(TokenPermissionChecker, (svc) => svc.assertSufficient(requirements));

const assertExact = (requirements: Record<string, "read" | "write" | "admin">) =>
	Effect.flatMap(TokenPermissionChecker, (svc) => svc.assertExact(requirements));

const warnOverPermissioned = (requirements: Record<string, "read" | "write" | "admin">) =>
	Effect.flatMap(TokenPermissionChecker, (svc) => svc.warnOverPermissioned(requirements));

describe("TokenPermissionCheckerLive", () => {
	it("check succeeds with sufficient permissions", async () => {
		const result = await run({ contents: "write", issues: "read" }, check({ contents: "write", issues: "read" }));
		expect(result.satisfied).toBe(true);
		expect(result.missing).toHaveLength(0);
	});

	it("assertSufficient fails when missing permissions", async () => {
		const exit = await runExit({ contents: "read" }, assertSufficient({ contents: "write" }));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(String(exit.cause)).toContain("TokenPermissionError");
		}
	});

	it("assertExact fails when extra permissions present", async () => {
		const exit = await runExit({ contents: "write", issues: "read" }, assertExact({ contents: "write" }));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(String(exit.cause)).toContain("TokenPermissionError");
		}
	});

	it("warnOverPermissioned never fails", async () => {
		const result = await run({ contents: "write", issues: "admin" }, warnOverPermissioned({ contents: "write" }));
		expect(result.satisfied).toBe(true);
		expect(result.extra).toHaveLength(1);
		expect(result.extra[0]).toEqual({ permission: "issues", level: "admin" });
	});

	describe("toErrorMissing granted field", () => {
		it("includes granted when permission exists but is insufficient", async () => {
			const exit = await runExit({ contents: "read" }, assertSufficient({ contents: "write" }));
			const error = extractError(exit);
			expect(error.missing).toEqual([{ permission: "contents", required: "write", granted: "read" }]);
			expect(error.reason).toContain("have read");
		});

		it("omits granted when permission is completely absent", async () => {
			const exit = await runExit({}, assertSufficient({ contents: "write" }));
			const error = extractError(exit);
			expect(error.missing).toEqual([{ permission: "contents", required: "write" }]);
			expect(error.reason).toContain("have none");
		});
	});

	describe("assertExact", () => {
		it("succeeds when permissions match exactly", async () => {
			const result = await run({ contents: "write" }, assertExact({ contents: "write" }));
			expect(result.satisfied).toBe(true);
			expect(result.extra).toHaveLength(0);
			expect(result.missing).toHaveLength(0);
		});

		it("fails with extra permissions listing each one", async () => {
			const exit = await runExit(
				{ contents: "write", issues: "read", actions: "admin" },
				assertExact({ contents: "write" }),
			);
			const error = extractError(exit);
			expect(error.reason).toContain("Over-permissioned token");
			expect(error.extra).toEqual([
				{ permission: "issues", level: "read" },
				{ permission: "actions", level: "admin" },
			]);
			expect(error.missing).toEqual([]);
		});

		it("fails with missing permissions before checking extra", async () => {
			const exit = await runExit({ issues: "read" }, assertExact({ contents: "write" }));
			const error = extractError(exit);
			expect(error.reason).toContain("Insufficient permissions");
			expect(error.reason).toContain("contents");
		});
	});
});
