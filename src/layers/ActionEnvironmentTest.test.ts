import type { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ActionEnvironment } from "../services/ActionEnvironment.js";
import { ActionEnvironmentTest } from "./ActionEnvironmentTest.js";

// payload/repo/issue carry a FileSystem requirement in their interface type
// (even though the Test layer does not use it), so tests provide one.
type Deps = ActionEnvironment | FileSystem.FileSystem;

const runEmpty = <A, E>(effect: Effect.Effect<A, E, Deps>) =>
	Effect.runPromise(Effect.provide(effect, Layer.merge(ActionEnvironmentTest.empty(), NodeFileSystem.layer)));

const runLayer = <A, E>(
	env: Record<string, string>,
	payload: Parameters<typeof ActionEnvironmentTest.layer>[1],
	effect: Effect.Effect<A, E, Deps>,
) =>
	Effect.runPromise(
		Effect.provide(effect, Layer.merge(ActionEnvironmentTest.layer(env, payload), NodeFileSystem.layer)),
	);

const exitLayer = <A, E>(
	env: Record<string, string>,
	payload: Parameters<typeof ActionEnvironmentTest.layer>[1],
	effect: Effect.Effect<A, E, Deps>,
) =>
	Effect.runPromise(
		Effect.exit(Effect.provide(effect, Layer.merge(ActionEnvironmentTest.layer(env, payload), NodeFileSystem.layer))),
	);

describe("ActionEnvironmentTest", () => {
	describe("empty", () => {
		it("payload is {}", async () => {
			const result = await runEmpty(Effect.flatMap(ActionEnvironment, (svc) => svc.payload));
			expect(result).toEqual({});
		});

		it("isDebug is false", async () => {
			const result = await runEmpty(Effect.flatMap(ActionEnvironment, (svc) => svc.isDebug));
			expect(result).toBe(false);
		});

		it("repo derives from the default owner/repo", async () => {
			const result = await runEmpty(Effect.flatMap(ActionEnvironment, (svc) => svc.repo));
			expect(result).toEqual({ owner: "owner", repo: "repo" });
		});

		it("issue fails (no number seeded)", async () => {
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						Effect.flatMap(ActionEnvironment, (svc) => svc.issue),
						Layer.merge(ActionEnvironmentTest.empty(), NodeFileSystem.layer),
					),
				),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("layer", () => {
		it("isDebug reads RUNNER_DEBUG", async () => {
			const result = await runLayer(
				{ RUNNER_DEBUG: "1" },
				{},
				Effect.flatMap(ActionEnvironment, (svc) => svc.isDebug),
			);
			expect(result).toBe(true);
		});

		it("accepts an injected payload", async () => {
			const result = await runLayer(
				{},
				{ pull_request: { number: 5 } },
				Effect.flatMap(ActionEnvironment, (svc) => svc.payload),
			);
			expect(result.pull_request?.number).toBe(5);
		});

		it("repo reads GITHUB_REPOSITORY from the env record", async () => {
			const result = await runLayer(
				{ GITHUB_REPOSITORY: "acme/widgets" },
				{},
				Effect.flatMap(ActionEnvironment, (svc) => svc.repo),
			);
			expect(result).toEqual({ owner: "acme", repo: "widgets" });
		});

		it("issue cascade resolves from the injected payload", async () => {
			const result = await runLayer(
				{ GITHUB_REPOSITORY: "acme/widgets" },
				{ issue: { number: 11 } },
				Effect.flatMap(ActionEnvironment, (svc) => svc.issue),
			);
			expect(result).toEqual({ owner: "acme", repo: "widgets", number: 11 });
		});

		it("issue fails when neither env nor payload supply a number", async () => {
			const exit = await exitLayer(
				{},
				{},
				Effect.flatMap(ActionEnvironment, (svc) => svc.issue),
			);
			expect(exit._tag).toBe("Failure");
		});
	});
});
