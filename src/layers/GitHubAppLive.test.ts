import { Effect, Exit } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubApp } from "../services/GitHubApp.js";
import { GitHubAppLive } from "./GitHubAppLive.js";

const mockAuth = vi.fn();

vi.mock("@octokit/auth-app", () => ({
	createAppAuth: vi.fn((..._args: Array<unknown>) => mockAuth),
}));

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

const run = <A, E>(effect: Effect.Effect<A, E, GitHubApp>) => Effect.runPromise(Effect.provide(effect, GitHubAppLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, GitHubApp>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, GitHubAppLive)));

beforeEach(() => {
	vi.clearAllMocks();
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
	globalThis.fetch = originalFetch;
});

const { createAppAuth } = await import("@octokit/auth-app");

describe("GitHubAppLive", () => {
	describe("generateToken", () => {
		it("calls createAppAuth with correct params and returns token", async () => {
			mockAuth.mockResolvedValue({
				token: "ghs_generated",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 999,
			});

			const result = await run(Effect.flatMap(GitHubApp, (svc) => svc.generateToken("app-42", "my-private-key", 999)));

			expect(result).toEqual({
				token: "ghs_generated",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 999,
				permissions: {},
			});
			expect(createAppAuth).toHaveBeenCalledWith({
				appId: "app-42",
				privateKey: "my-private-key",
			});
			expect(mockAuth).toHaveBeenCalledWith({
				type: "installation",
				installationId: 999,
			});
		});

		it("wraps errors as GitHubAppError", async () => {
			mockAuth.mockRejectedValue(new Error("auth failed"));
			const exit = await runExit(Effect.flatMap(GitHubApp, (svc) => svc.generateToken("app-1", "pk")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("revokeToken", () => {
		it("calls the GitHub API with DELETE", async () => {
			mockFetch.mockResolvedValue({ ok: true, status: 204 });
			await run(Effect.flatMap(GitHubApp, (svc) => svc.revokeToken("ghs_test")));
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.github.com/installation/token",
				expect.objectContaining({
					method: "DELETE",
					headers: expect.objectContaining({
						Authorization: "token ghs_test",
					}),
				}),
			);
		});

		it("wraps non-204 errors", async () => {
			mockFetch.mockResolvedValue({ ok: false, status: 401 });
			const exit = await runExit(Effect.flatMap(GitHubApp, (svc) => svc.revokeToken("ghs_bad")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("withToken", () => {
		it("generates token, runs effect, and revokes", async () => {
			mockAuth.mockResolvedValue({
				token: "ghs_bracket",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 1,
			});
			mockFetch.mockResolvedValue({ ok: true, status: 204 });

			const result = await run(
				Effect.flatMap(GitHubApp, (svc) => svc.withToken("app-1", "pk", (token) => Effect.succeed(`used:${token}`))),
			);

			expect(result).toBe("used:ghs_bracket");
			expect(mockAuth).toHaveBeenCalled();
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.github.com/installation/token",
				expect.objectContaining({ method: "DELETE" }),
			);
		});

		it("revokes even when effect fails", async () => {
			mockAuth.mockResolvedValue({
				token: "ghs_fail",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 1,
			});
			mockFetch.mockResolvedValue({ ok: true, status: 204 });

			const exit = await runExit(
				Effect.flatMap(GitHubApp, (svc) =>
					svc.withToken("app-1", "pk", (_token) => Effect.fail(new Error("inner fail"))),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.github.com/installation/token",
				expect.objectContaining({ method: "DELETE" }),
			);
		});
	});
});
