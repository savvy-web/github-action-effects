import { Data, Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubAppError } from "../errors/GitHubAppError.js";
import { GitHubAppTest } from "../layers/GitHubAppTest.js";
import { GitHubApp, InstallationToken } from "./GitHubApp.js";

// -- Shared provide helper --

const provide = <A, E>(state: ReturnType<typeof GitHubAppTest.empty>, effect: Effect.Effect<A, E, GitHubApp>) =>
	Effect.provide(effect, GitHubAppTest.layer(state));

const run = <A, E>(state: ReturnType<typeof GitHubAppTest.empty>, effect: Effect.Effect<A, E, GitHubApp>) =>
	Effect.runPromise(provide(state, effect));

const runExit = <A, E>(state: ReturnType<typeof GitHubAppTest.empty>, effect: Effect.Effect<A, E, GitHubApp>) =>
	Effect.runPromise(Effect.exit(provide(state, effect)));

// -- Service method shorthands --

const generateToken = (appId: string, privateKey: string, installationId?: number) =>
	Effect.flatMap(GitHubApp, (svc) => svc.generateToken(appId, privateKey, installationId));

const revokeToken = (token: string) => Effect.flatMap(GitHubApp, (svc) => svc.revokeToken(token));

const withToken = <A, E, R>(appId: string, privateKey: string, effect: (token: string) => Effect.Effect<A, E, R>) =>
	Effect.flatMap(GitHubApp, (svc) => svc.withToken(appId, privateKey, effect));

describe("GitHubApp", () => {
	describe("generateToken", () => {
		it("returns the configured token", async () => {
			const state = GitHubAppTest.empty();
			const result = await run(state, generateToken("app-1", "private-key"));
			expect(result).toEqual(state.tokenToReturn);
		});

		it("records the call", async () => {
			const state = GitHubAppTest.empty();
			await run(state, generateToken("app-1", "private-key", 42));
			expect(state.generateCalls).toHaveLength(1);
			expect(state.generateCalls[0]).toEqual({
				appId: "app-1",
				privateKey: "private-key",
				installationId: 42,
			});
		});
	});

	describe("revokeToken", () => {
		it("records the call", async () => {
			const state = GitHubAppTest.empty();
			await run(state, revokeToken("ghs_abc123"));
			expect(state.revokeCalls).toHaveLength(1);
			expect(state.revokeCalls[0]).toBe("ghs_abc123");
		});
	});

	describe("withToken", () => {
		it("brackets correctly: generate → use → revoke", async () => {
			const state = GitHubAppTest.empty();
			const result = await run(
				state,
				withToken("app-1", "pk", (token) => Effect.succeed(`used:${token}`)),
			);
			expect(result).toBe(`used:${state.tokenToReturn.token}`);
			expect(state.generateCalls).toHaveLength(1);
			expect(state.revokeCalls).toHaveLength(1);
			expect(state.revokeCalls[0]).toBe(state.tokenToReturn.token);
		});

		it("revokes on failure", async () => {
			const state = GitHubAppTest.empty();

			class TestError extends Data.TaggedError("TestError")<{ readonly message: string }> {}

			const exit = await runExit(
				state,
				withToken("app-1", "pk", (_token) => Effect.fail(new TestError({ message: "boom" }))),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(state.generateCalls).toHaveLength(1);
			expect(state.revokeCalls).toHaveLength(1);
			expect(state.revokeCalls[0]).toBe(state.tokenToReturn.token);
		});

		it("propagates inner effect errors", async () => {
			const state = GitHubAppTest.empty();

			class MyError extends Data.TaggedError("MyError")<{ readonly code: number }> {}

			const exit = await runExit(
				state,
				withToken("app-1", "pk", (_token) => Effect.fail(new MyError({ code: 42 }))),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(String(exit.cause)).toContain("MyError");
			}
		});
	});

	describe("botIdentity", () => {
		it("returns a verified identity when both appSlug and appUserId are provided", async () => {
			const state = GitHubAppTest.empty();
			const result = await run(
				state,
				Effect.flatMap(GitHubApp, (svc) => Effect.succeed(svc.botIdentity({ appSlug: "my-app", appUserId: 99 }))),
			);
			expect(result.name).toBe("my-app[bot]");
			expect(result.email).toBe("99+my-app[bot]@users.noreply.github.com");
		});

		it("returns default github-actions bot when no source is given", async () => {
			const state = GitHubAppTest.empty();
			const result = await run(
				state,
				Effect.flatMap(GitHubApp, (svc) => Effect.succeed(svc.botIdentity())),
			);
			expect(result.name).toBe("github-actions[bot]");
			expect(result.email).toBe("41898282+github-actions[bot]@users.noreply.github.com");
		});
	});

	describe("GitHubAppError", () => {
		it("is a tagged error with correct fields", () => {
			const error = new GitHubAppError({
				operation: "token",
				reason: "invalid key",
			});
			expect(error._tag).toBe("GitHubAppError");
			expect(error.operation).toBe("token");
			expect(error.reason).toBe("invalid key");
		});
	});
});

describe("InstallationToken schema", () => {
	const decode = Schema.decodeUnknownSync(InstallationToken);

	it("retains the optional identity fields when present", () => {
		const result = decode({
			token: "ghs_abc",
			expiresAt: "2099-01-01T00:00:00Z",
			installationId: 7,
			appSlug: "acme-bot",
			appUserId: 123456,
			appName: "Acme Bot",
			permissions: { contents: "write" },
		});

		expect(result.appSlug).toBe("acme-bot");
		expect(result.appUserId).toBe(123456);
		expect(result.appName).toBe("Acme Bot");
	});

	it("decodes a token with no identity fields (backward compatible)", () => {
		const result = decode({
			token: "ghs_abc",
			expiresAt: "2099-01-01T00:00:00Z",
			installationId: 7,
		});

		expect(result.appSlug).toBeUndefined();
		expect(result.appUserId).toBeUndefined();
		expect(result.appName).toBeUndefined();
		expect(result.permissions).toEqual({});
	});
});
