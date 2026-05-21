import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubToken } from "./GitHubToken.js";
import { ActionOutputsTest } from "./layers/ActionOutputsTest.js";
import { ActionStateTest } from "./layers/ActionStateTest.js";
import type { GitHubAppTestState } from "./layers/GitHubAppTest.js";
import { GitHubAppTest } from "./layers/GitHubAppTest.js";
import { ActionState } from "./services/ActionState.js";
import type { BotIdentity, InstallationToken } from "./services/GitHubApp.js";
import { InstallationToken as InstallationTokenSchema } from "./services/GitHubApp.js";
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
const appStateWith = (
	token: InstallationToken,
	appIdentity?: { appSlug: string; appUserId: number; appName: string },
): GitHubAppTestState => ({
	generateCalls: [],
	revokeCalls: [],
	tokenToReturn: token,
	...(appIdentity !== undefined ? { appIdentity } : {}),
});

/** Provide GitHubApp + ActionState + ActionOutputs for a `provision` run. */
const provisionLayer = (
	state: ReturnType<typeof ActionStateTest.empty>,
	appState: GitHubAppTestState,
	outputs: ReturnType<typeof ActionOutputsTest.empty>,
) => Layer.mergeAll(ActionStateTest.layer(state), GitHubAppTest.layer(appState), ActionOutputsTest.layer(outputs));

beforeEach(() => {
	octokitAuthCalls.length = 0;
});

describe("GitHubToken", () => {
	describe("provision", () => {
		it("generates a token with explicit credentials and persists it", async () => {
			const appState = appStateWith({
				token: Redacted.make("ghs_provisioned"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: { contents: "write" },
			});
			const state = ActionStateTest.empty();
			const outputs = ActionOutputsTest.empty();

			const token = await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ clientId: "Iv1.abc", privateKey: "pk", installationId: 7 }),
					provisionLayer(state, appState, outputs),
				),
			);

			expect(Redacted.value(token.token)).toBe("ghs_provisioned");
			expect(state.entries.has(STATE_KEY)).toBe(true);
			expect(appState.generateCalls).toHaveLength(1);
			expect(appState.generateCalls[0]?.appId).toBe("Iv1.abc");
			expect(appState.generateCalls[0]?.installationId).toBe(7);
		});

		it("threads the redacted private key through provision without unwrapping early (S1)", async () => {
			const appState = appStateWith({
				token: Redacted.make("ghs_redacted"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: {},
			});
			const state = ActionStateTest.empty();
			const outputs = ActionOutputsTest.empty();

			await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ clientId: "Iv1.abc", privateKey: Redacted.make("pk"), installationId: 7 }),
					provisionLayer(state, appState, outputs),
				),
			);

			const passedKey = appState.generateCalls[0]?.privateKey;
			expect(passedKey).toBeDefined();
			expect(Redacted.isRedacted(passedKey)).toBe(true);
			expect(Redacted.value(passedKey as Redacted.Redacted<string>)).toBe("pk");
		});

		it("masks the generated token via setSecret (S3 defense)", async () => {
			const appState = appStateWith({
				token: Redacted.make("ghs_secret"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: {},
			});
			const state = ActionStateTest.empty();
			const outputs = ActionOutputsTest.empty();

			await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ clientId: "Iv1.abc", privateKey: "pk", installationId: 7 }),
					provisionLayer(state, appState, outputs),
				),
			);

			expect(outputs.secrets).toContain("ghs_secret");
		});

		it("persists the installation token as a Redacted field that round-trips through ActionState (S3)", async () => {
			const appState = appStateWith({
				token: Redacted.make("ghs_roundtrip"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: {},
			});
			const state = ActionStateTest.empty();
			const outputs = ActionOutputsTest.empty();

			await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ clientId: "Iv1.abc", privateKey: "pk", installationId: 7 }),
					provisionLayer(state, appState, outputs),
				),
			);

			// The encoded GITHUB_STATE line still contains the raw token bytes
			// (encode is transparent).
			const persisted = JSON.parse(state.entries.get(STATE_KEY) ?? "{}");
			expect(persisted.token).toBe("ghs_roundtrip");

			// Reading it back decodes the token into a Redacted wrapper.
			const readBack = await Effect.runPromise(Effect.provide(GitHubToken.read(), ActionStateTest.layer(state)));
			expect(Redacted.isRedacted(readBack.token)).toBe(true);
			expect(Redacted.value(readBack.token)).toBe("ghs_roundtrip");
		});

		it("reads credentials from Config when none are passed", async () => {
			const appState = appStateWith({
				token: Redacted.make("ghs_from_config"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: {},
			});
			const state = ActionStateTest.empty();
			const outputs = ActionOutputsTest.empty();
			const configProvider = ConfigProvider.fromMap(
				new Map([
					["app-client-id", "Iv1.config"],
					["app-private-key", "config-pk"],
				]),
			);

			const token = await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ installationId: 7 }).pipe(Effect.withConfigProvider(configProvider)),
					provisionLayer(state, appState, outputs),
				),
			);

			expect(Redacted.value(token.token)).toBe("ghs_from_config");
			expect(appState.generateCalls[0]?.appId).toBe("Iv1.config");
			expect(Redacted.value(appState.generateCalls[0]?.privateKey as Redacted.Redacted<string>)).toBe("config-pk");
		});

		it("passes the permission check when scopes are sufficient", async () => {
			const appState = appStateWith({
				token: Redacted.make("ghs_ok"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: { contents: "write" },
			});
			const state = ActionStateTest.empty();
			const outputs = ActionOutputsTest.empty();

			const token = await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({
						clientId: "Iv1.abc",
						privateKey: "pk",
						installationId: 7,
						permissions: { contents: "write" },
					}),
					provisionLayer(state, appState, outputs),
				),
			);

			expect(Redacted.value(token.token)).toBe("ghs_ok");
		});

		it("revokes the generated token and fails when a required scope is missing", async () => {
			const appState = appStateWith({
				token: Redacted.make("ghs_weak"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: { contents: "read" },
			});
			const state = ActionStateTest.empty();
			const outputs = ActionOutputsTest.empty();

			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						GitHubToken.provision({
							clientId: "Iv1.abc",
							privateKey: "pk",
							installationId: 7,
							permissions: { contents: "write" },
						}),
						provisionLayer(state, appState, outputs),
					),
				),
			);

			expect(exit._tag).toBe("Failure");
			expect(state.entries.has(STATE_KEY)).toBe(false);
			expect(appState.revokeCalls.map((t) => Redacted.value(t))).toContain("ghs_weak");
		});

		it("resolves and persists the App identity", async () => {
			const appState = appStateWith(
				{
					token: Redacted.make("ghs_with_identity"),
					expiresAt: "2099-01-01T00:00:00Z",
					installationId: 7,
					permissions: {},
				},
				{ appSlug: "acme-bot", appUserId: 123456, appName: "Acme Bot" },
			);
			const state = ActionStateTest.empty();
			const outputs = ActionOutputsTest.empty();

			const token = await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ clientId: "Iv1.abc", privateKey: "pk", installationId: 7 }),
					provisionLayer(state, appState, outputs),
				),
			);

			expect(token.appSlug).toBe("acme-bot");
			expect(token.appUserId).toBe(123456);
			expect(token.appName).toBe("Acme Bot");

			const persisted = JSON.parse(state.entries.get(STATE_KEY) ?? "{}");
			expect(persisted.appSlug).toBe("acme-bot");
			expect(persisted.appUserId).toBe(123456);
		});

		it("persists the token without identity when resolution fails", async () => {
			const appState = appStateWith({
				token: Redacted.make("ghs_no_identity"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: {},
			});
			const state = ActionStateTest.empty();
			const outputs = ActionOutputsTest.empty();

			const token = await Effect.runPromise(
				Effect.provide(
					GitHubToken.provision({ clientId: "Iv1.abc", privateKey: "pk", installationId: 7 }),
					provisionLayer(state, appState, outputs),
				),
			);

			expect(Redacted.value(token.token)).toBe("ghs_no_identity");
			expect(token.appSlug).toBeUndefined();
			expect(state.entries.has(STATE_KEY)).toBe(true);
		});
	});

	describe("client", () => {
		const persist = (state: ReturnType<typeof ActionStateTest.empty>) =>
			Effect.runPromise(
				Effect.provide(
					Effect.flatMap(ActionState, (s) =>
						s.save(
							STATE_KEY,
							{
								token: Redacted.make("ghs_persisted"),
								expiresAt: "2099-01-01T00:00:00Z",
								installationId: 7,
								permissions: {},
							},
							InstallationTokenSchema,
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
							{
								token: Redacted.make("ghs_to_revoke"),
								expiresAt: "2099-01-01T00:00:00Z",
								installationId: 7,
								permissions: {},
							},
							InstallationTokenSchema,
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

			expect(appState.revokeCalls.map((t) => Redacted.value(t))).toContain("ghs_to_revoke");
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

	describe("read", () => {
		it("returns the persisted installation token with identity fields", async () => {
			const state = ActionStateTest.empty();
			await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(ActionState, (s) =>
						s.save(
							STATE_KEY,
							{
								token: Redacted.make("ghs_persisted"),
								expiresAt: "2099-01-01T00:00:00Z",
								installationId: 7,
								appSlug: "acme-bot",
								appUserId: 123456,
								appName: "Acme Bot",
								permissions: {},
							},
							InstallationTokenSchema,
						),
					),
					ActionStateTest.layer(state),
				),
			);

			const token = await Effect.runPromise(Effect.provide(GitHubToken.read(), ActionStateTest.layer(state)));

			expect(Redacted.value(token.token)).toBe("ghs_persisted");
			expect(token.appSlug).toBe("acme-bot");
			expect(token.appUserId).toBe(123456);
			expect(token.appName).toBe("Acme Bot");
		});

		it("fails when no token was provisioned", async () => {
			const state = ActionStateTest.empty();
			const exit = await Effect.runPromise(
				Effect.exit(Effect.provide(GitHubToken.read(), ActionStateTest.layer(state))),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("botIdentity", () => {
		const persist = (state: ReturnType<typeof ActionStateTest.empty>, token: InstallationToken) =>
			Effect.runPromise(
				Effect.provide(
					Effect.flatMap(ActionState, (s) => s.save(STATE_KEY, token, InstallationTokenSchema)),
					ActionStateTest.layer(state),
				),
			);

		it("derives a verified identity from the persisted token", async () => {
			const state = ActionStateTest.empty();
			await persist(state, {
				token: Redacted.make("ghs_persisted"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				appSlug: "acme-bot",
				appUserId: 123456,
				appName: "Acme Bot",
				permissions: {},
			});

			const identity: BotIdentity = await Effect.runPromise(
				Effect.provide(GitHubToken.botIdentity(), ActionStateTest.layer(state)),
			);

			expect(identity).toEqual({
				name: "acme-bot[bot]",
				email: "123456+acme-bot[bot]@users.noreply.github.com",
			});
		});

		it("falls back to github-actions[bot] when identity fields are absent", async () => {
			const state = ActionStateTest.empty();
			await persist(state, {
				token: Redacted.make("ghs_persisted"),
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 7,
				permissions: {},
			});

			const identity = await Effect.runPromise(Effect.provide(GitHubToken.botIdentity(), ActionStateTest.layer(state)));

			expect(identity).toEqual({
				name: "github-actions[bot]",
				email: "41898282+github-actions[bot]@users.noreply.github.com",
			});
		});
	});
});
