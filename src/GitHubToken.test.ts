import { ConfigProvider, Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubToken } from "./GitHubToken.js";
import { ActionStateTest } from "./layers/ActionStateTest.js";
import type { GitHubAppTestState } from "./layers/GitHubAppTest.js";
import { GitHubAppTest } from "./layers/GitHubAppTest.js";
import { ActionState } from "./services/ActionState.js";
import { InstallationToken } from "./services/GitHubApp.js";
import { GitHubClient } from "./services/GitHubClient.js";

const { octokitAuthCalls } = vi.hoisted(() => ({ octokitAuthCalls: [] as unknown[] }));
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

/** Build a GitHubApp test state that returns the given installation token. */
const appStateWith = (token: InstallationToken): GitHubAppTestState => ({
	generateCalls: [],
	revokeCalls: [],
	tokenToReturn: token,
});

beforeEach(() => {
	octokitAuthCalls.length = 0;
});

describe("GitHubToken", () => {
	describe("provision", () => {
		it("generates a token with explicit credentials and persists it", async () => {
			const appState = appStateWith({
				token: "ghs_provisioned",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: { contents: "write" },
			});
			const state = ActionStateTest.empty();

			const token = await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ clientId: "Iv1.abc", privateKey: "pk", installationId: 7 }),
					Layer.mergeAll(ActionStateTest.layer(state), GitHubAppTest.layer(appState)),
				),
			);

			expect(token.token).toBe("ghs_provisioned");
			expect(state.entries.has(STATE_KEY)).toBe(true);
			expect(appState.generateCalls).toEqual([{ appId: "Iv1.abc", privateKey: "pk", installationId: 7 }]);
		});

		it("reads credentials from Config when none are passed", async () => {
			const appState = appStateWith({
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
					Layer.mergeAll(ActionStateTest.layer(state), GitHubAppTest.layer(appState)),
				),
			);

			expect(token.token).toBe("ghs_from_config");
			expect(appState.generateCalls[0]?.appId).toBe("Iv1.config");
		});

		it("passes the permission check when scopes are sufficient", async () => {
			const appState = appStateWith({
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
					Layer.mergeAll(ActionStateTest.layer(state), GitHubAppTest.layer(appState)),
				),
			);

			expect(token.token).toBe("ghs_ok");
		});

		it("revokes the generated token and fails when a required scope is missing", async () => {
			const appState = appStateWith({
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
						Layer.mergeAll(ActionStateTest.layer(state), GitHubAppTest.layer(appState)),
					),
				),
			);

			expect(exit._tag).toBe("Failure");
			expect(state.entries.has(STATE_KEY)).toBe(false);
			expect(appState.revokeCalls).toContain("ghs_weak");
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
			const appState = GitHubAppTest.empty();

			await Effect.runPromise(
				Effect.provide(
					GitHubToken.dispose(),
					Layer.mergeAll(ActionStateTest.layer(state), GitHubAppTest.layer(appState)),
				),
			);

			expect(appState.revokeCalls).toContain("ghs_to_revoke");
		});

		it("is a no-op when no token was provisioned", async () => {
			const state = ActionStateTest.empty();
			const appState = GitHubAppTest.empty();

			await Effect.runPromise(
				Effect.provide(
					GitHubToken.dispose(),
					Layer.mergeAll(ActionStateTest.layer(state), GitHubAppTest.layer(appState)),
				),
			);

			expect(appState.revokeCalls).toHaveLength(0);
		});
	});
});
