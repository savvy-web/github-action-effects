import { ConfigProvider, Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubToken } from "./GitHubToken.js";
import { ActionStateTest } from "./layers/ActionStateTest.js";
import { ActionState } from "./services/ActionState.js";
import { InstallationToken } from "./services/GitHubApp.js";
import { GitHubClient } from "./services/GitHubClient.js";

const { mockAuth, octokitAuthCalls } = vi.hoisted(() => ({
	mockAuth: vi.fn(),
	octokitAuthCalls: [] as unknown[],
}));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: () => mockAuth }));
vi.mock("@octokit/rest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@octokit/rest")>();
	class RecordingOctokit extends actual.Octokit {
		constructor(options?: ConstructorParameters<typeof actual.Octokit>[0]) {
			super(options);
			octokitAuthCalls.push(options?.auth);
		}
	}
	return { ...actual, Octokit: RecordingOctokit };
});

const STATE_KEY = "github-action-effects/installation-token";

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("GitHubToken", () => {
	describe("provision", () => {
		it("generates a token with explicit credentials and persists it", async () => {
			mockAuth.mockResolvedValue({
				token: "ghs_provisioned",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: { contents: "write" },
			});
			const state = ActionStateTest.empty();

			const token = await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ clientId: "Iv1.abc", privateKey: "pk", installationId: 7 }),
					ActionStateTest.layer(state),
				),
			);

			expect(token.token).toBe("ghs_provisioned");
			expect(state.entries.has(STATE_KEY)).toBe(true);
		});

		it("reads credentials from Config when none are passed", async () => {
			mockAuth.mockResolvedValue({
				token: "ghs_from_config",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: {},
			});
			const state = ActionStateTest.empty();
			const configProvider = ConfigProvider.fromMap(
				new Map([
					["app-client-id", "Iv1.config"],
					["app-private-key", "config-pk"],
				]),
			);

			const token = await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ installationId: 7 }).pipe(Effect.withConfigProvider(configProvider)),
					ActionStateTest.layer(state),
				),
			);
			expect(token.token).toBe("ghs_from_config");
		});

		it("passes the permission check when scopes are sufficient", async () => {
			mockAuth.mockResolvedValue({
				token: "ghs_ok",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: { contents: "write" },
			});
			const state = ActionStateTest.empty();

			const token = await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({
						clientId: "Iv1.abc",
						privateKey: "pk",
						installationId: 7,
						permissions: { contents: "write" },
					}),
					ActionStateTest.layer(state),
				),
			);
			expect(token.token).toBe("ghs_ok");
		});

		it("fails with TokenPermissionError when a required scope is missing", async () => {
			mockAuth.mockResolvedValue({
				token: "ghs_weak",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: { contents: "read" },
			});
			const state = ActionStateTest.empty();

			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						GitHubToken.provision({
							clientId: "Iv1.abc",
							privateKey: "pk",
							installationId: 7,
							permissions: { contents: "write" },
						}),
						ActionStateTest.layer(state),
					),
				),
			);
			expect(exit._tag).toBe("Failure");
			expect(state.entries.has(STATE_KEY)).toBe(false);
		});
	});

	describe("client", () => {
		const persist = (state: ReturnType<typeof ActionStateTest.empty>) =>
			Effect.runPromise(
				Effect.provide(
					Effect.flatMap(ActionState, (s) =>
						s.save(
							STATE_KEY,
							{ token: "ghs_persisted", expiresAt: "2099-01-01T00:00:00Z", installationId: 7, permissions: {} },
							InstallationToken,
						),
					),
					ActionStateTest.layer(state),
				),
			);

		it("builds a GitHubClient from the persisted token", async () => {
			octokitAuthCalls.length = 0;
			const state = ActionStateTest.empty();
			await persist(state);

			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (c) => c.rest("op", () => Promise.resolve({ data: "ok" }))),
					GitHubToken.client().pipe(Layer.provide(ActionStateTest.layer(state))),
				),
			);
			expect(result).toBe("ok");
			expect(octokitAuthCalls).toContain("ghs_persisted");
		});

		it("fails when no token was provisioned", async () => {
			const state = ActionStateTest.empty();
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						Effect.flatMap(GitHubClient, (c) => c.repo),
						GitHubToken.client().pipe(Layer.provide(ActionStateTest.layer(state))),
					),
				),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("dispose", () => {
		it("revokes the persisted token", async () => {
			const state = ActionStateTest.empty();
			await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(ActionState, (s) =>
						s.save(
							STATE_KEY,
							{ token: "ghs_to_revoke", expiresAt: "2099-01-01T00:00:00Z", installationId: 7, permissions: {} },
							InstallationToken,
						),
					),
					ActionStateTest.layer(state),
				),
			);

			const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
			vi.stubGlobal("fetch", fetchMock);

			await Effect.runPromise(Effect.provide(GitHubToken.dispose(), ActionStateTest.layer(state)));
			expect(fetchMock).toHaveBeenCalledWith(
				"https://api.github.com/installation/token",
				expect.objectContaining({
					method: "DELETE",
					headers: expect.objectContaining({ Authorization: "token ghs_to_revoke" }),
				}),
			);
		});

		it("is a no-op when no token was provisioned", async () => {
			const state = ActionStateTest.empty();
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);

			await Effect.runPromise(Effect.provide(GitHubToken.dispose(), ActionStateTest.layer(state)));
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});
});
