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

/** Mock the auto-discovery flow: JWT → list installations → resolve ID. */
const mockAutoDiscovery = (installationId: number) => {
	mockAuth.mockResolvedValueOnce({ token: "jwt_for_discovery" });
	mockFetch.mockResolvedValueOnce({
		ok: true,
		status: 200,
		json: async () => [{ id: installationId, account: { login: "test-owner" } }],
	});
};

beforeEach(() => {
	vi.resetAllMocks();
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

		it("auto-discovers installationId when not provided", async () => {
			const originalEnv = process.env.GITHUB_REPOSITORY;
			process.env.GITHUB_REPOSITORY = "savvy-web/my-repo";

			try {
				// First call: auth({ type: "app" }) → JWT
				mockAuth.mockResolvedValueOnce({ token: "jwt_app_token" });
				// fetch: GET /app/installations → installation list
				mockFetch.mockResolvedValueOnce({
					ok: true,
					status: 200,
					json: async () => [
						{ id: 111, account: { login: "other-org" } },
						{ id: 222, account: { login: "savvy-web" } },
					],
				});
				// Second call: auth({ type: "installation", installationId: 222 }) → token
				mockAuth.mockResolvedValueOnce({
					token: "ghs_discovered",
					expiresAt: "2099-01-01T00:00:00Z",
					installationId: 222,
				});

				const result = await run(Effect.flatMap(GitHubApp, (svc) => svc.generateToken("app-42", "my-private-key")));

				expect(result).toEqual({
					token: "ghs_discovered",
					expiresAt: "2099-01-01T00:00:00Z",
					installationId: 222,
					permissions: {},
				});
				// Should get JWT first
				expect(mockAuth).toHaveBeenCalledWith({ type: "app" });
				// Should fetch installations with JWT
				expect(mockFetch).toHaveBeenCalledWith(
					"https://api.github.com/app/installations",
					expect.objectContaining({
						headers: expect.objectContaining({
							Authorization: "Bearer jwt_app_token",
						}),
					}),
				);
				// Should use discovered installationId
				expect(mockAuth).toHaveBeenCalledWith({
					type: "installation",
					installationId: 222,
				});
			} finally {
				if (originalEnv !== undefined) {
					process.env.GITHUB_REPOSITORY = originalEnv;
				} else {
					delete process.env.GITHUB_REPOSITORY;
				}
			}
		});

		it("falls back to first installation when GITHUB_REPOSITORY not set", async () => {
			const originalEnv = process.env.GITHUB_REPOSITORY;
			delete process.env.GITHUB_REPOSITORY;

			try {
				mockAuth.mockResolvedValueOnce({ token: "jwt_token" });
				mockFetch.mockResolvedValueOnce({
					ok: true,
					status: 200,
					json: async () => [{ id: 555, account: { login: "some-org" } }],
				});
				mockAuth.mockResolvedValueOnce({
					token: "ghs_fallback",
					expiresAt: "2099-01-01T00:00:00Z",
					installationId: 555,
				});

				const result = await run(Effect.flatMap(GitHubApp, (svc) => svc.generateToken("app-1", "pk")));

				expect(result.installationId).toBe(555);
				expect(mockAuth).toHaveBeenCalledWith({
					type: "installation",
					installationId: 555,
				});
			} finally {
				if (originalEnv !== undefined) {
					process.env.GITHUB_REPOSITORY = originalEnv;
				} else {
					delete process.env.GITHUB_REPOSITORY;
				}
			}
		});

		it("errors when no installations found", async () => {
			const originalEnv = process.env.GITHUB_REPOSITORY;
			delete process.env.GITHUB_REPOSITORY;

			try {
				mockAuth.mockResolvedValueOnce({ token: "jwt_token" });
				mockFetch.mockResolvedValueOnce({
					ok: true,
					status: 200,
					json: async () => [],
				});

				const exit = await runExit(Effect.flatMap(GitHubApp, (svc) => svc.generateToken("app-1", "pk")));
				expect(exit._tag).toBe("Failure");
			} finally {
				if (originalEnv !== undefined) {
					process.env.GITHUB_REPOSITORY = originalEnv;
				} else {
					delete process.env.GITHUB_REPOSITORY;
				}
			}
		});

		it("wraps errors as GitHubAppError", async () => {
			mockAuth.mockRejectedValue(new Error("auth failed"));
			const exit = await runExit(Effect.flatMap(GitHubApp, (svc) => svc.generateToken("app-1", "pk", 123)));
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
			// Auto-discovery: JWT → installations list
			mockAutoDiscovery(1);
			// Installation token
			mockAuth.mockResolvedValueOnce({
				token: "ghs_bracket",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 1,
			});
			// Revoke fetch
			mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

			const result = await run(
				Effect.flatMap(GitHubApp, (svc) => svc.withToken("app-1", "pk", (token) => Effect.succeed(`used:${token}`))),
			);

			expect(result).toBe("used:ghs_bracket");
			expect(mockAuth).toHaveBeenCalledWith({ type: "app" });
			expect(mockAuth).toHaveBeenCalledWith({ type: "installation", installationId: 1 });
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.github.com/installation/token",
				expect.objectContaining({ method: "DELETE" }),
			);
		});

		it("revokes even when effect fails", async () => {
			// Auto-discovery: JWT → installations list
			mockAutoDiscovery(1);
			// Installation token
			mockAuth.mockResolvedValueOnce({
				token: "ghs_fail",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 1,
			});
			// Revoke fetch
			mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

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
