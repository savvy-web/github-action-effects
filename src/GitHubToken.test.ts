import { ConfigProvider, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubToken } from "./GitHubToken.js";
import { ActionStateTest } from "./layers/ActionStateTest.js";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: () => mockAuth }));

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
});
