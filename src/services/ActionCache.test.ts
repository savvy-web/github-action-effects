import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { ActionCacheError } from "../errors/ActionCacheError.js";
import type { ActionCacheTestState } from "../layers/ActionCacheTest.js";
import { ActionCacheTest } from "../layers/ActionCacheTest.js";
import { ActionCache } from "./ActionCache.js";

// -- Shared provide helper --

const provide = <A, E>(state: ActionCacheTestState, effect: Effect.Effect<A, E, ActionCache>) =>
	Effect.provide(effect, ActionCacheTest.layer(state));

const run = <A, E>(state: ActionCacheTestState, effect: Effect.Effect<A, E, ActionCache>) =>
	Effect.runPromise(provide(state, effect));

const runExit = <A, E>(state: ActionCacheTestState, effect: Effect.Effect<A, E, ActionCache>) =>
	Effect.runPromise(Effect.exit(provide(state, effect)));

// -- Service method shorthands --

const save = (key: string, paths: ReadonlyArray<string>) => Effect.flatMap(ActionCache, (svc) => svc.save(key, paths));

const restore = (key: string, paths: ReadonlyArray<string>, restoreKeys?: ReadonlyArray<string>) =>
	Effect.flatMap(ActionCache, (svc) => svc.restore(key, paths, restoreKeys));

const withCache = <A, E>(
	key: string,
	paths: ReadonlyArray<string>,
	effect: Effect.Effect<A, E>,
	restoreKeys?: ReadonlyArray<string>,
) => Effect.flatMap(ActionCache, (svc) => svc.withCache(key, paths, effect, restoreKeys));

describe("ActionCache", () => {
	describe("save", () => {
		it("stores entry in test state", async () => {
			const state = ActionCacheTest.empty();
			await run(state, save("my-key", ["path/a", "path/b"]));
			expect(state.entries.has("my-key")).toBe(true);
			expect(state.entries.get("my-key")).toEqual(["path/a", "path/b"]);
		});

		it("overwrites existing entry with same key", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("my-key", ["old/path"]);
			await run(state, save("my-key", ["new/path"]));
			expect(state.entries.get("my-key")).toEqual(["new/path"]);
		});
	});

	describe("restore", () => {
		it("returns hit on exact key match", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("my-key", ["path/a"]);
			const result = await run(state, restore("my-key", ["path/a"]));
			expect(result.hit).toBe(true);
			expect(result.matchedKey).toBe("my-key");
		});

		it("returns hit on restore key prefix match", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("cache-abc123", ["path/a"]);
			const result = await run(state, restore("cache-xyz", ["path/a"], ["cache-"]));
			expect(result.hit).toBe(true);
			expect(result.matchedKey).toBe("cache-abc123");
		});

		it("returns miss on unknown key", async () => {
			const state = ActionCacheTest.empty();
			const result = await run(state, restore("missing-key", ["path/a"]));
			expect(result.hit).toBe(false);
			expect(result.matchedKey).toBeUndefined();
		});

		it("returns miss when no restore keys match", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("other-key", ["path/a"]);
			const result = await run(state, restore("missing", ["path/a"], ["no-match-"]));
			expect(result.hit).toBe(false);
			expect(result.matchedKey).toBeUndefined();
		});
	});

	describe("withCache", () => {
		it("runs effect on miss then saves", async () => {
			const state = ActionCacheTest.empty();
			let effectRan = false;
			const effect = Effect.sync(() => {
				effectRan = true;
				return "computed-value";
			});
			const result = await run(state, withCache("my-key", ["path/a"], effect));
			expect(result).toBe("computed-value");
			expect(effectRan).toBe(true);
			// Should have saved after miss
			expect(state.entries.has("my-key")).toBe(true);
			expect(state.entries.get("my-key")).toEqual(["path/a"]);
		});

		it("runs effect on exact hit without saving again", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("my-key", ["original/path"]);
			const result = await run(state, withCache("my-key", ["path/a"], Effect.succeed("cached-value")));
			expect(result).toBe("cached-value");
			// Should NOT have overwritten with new paths
			expect(state.entries.get("my-key")).toEqual(["original/path"]);
		});

		it("saves on partial hit (restore key match but not exact key)", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("cache-old", ["path/a"]);
			const result = await run(state, withCache("cache-new", ["path/b"], Effect.succeed("value"), ["cache-"]));
			expect(result).toBe("value");
			// Should save under the new key since it was only a partial hit
			expect(state.entries.has("cache-new")).toBe(true);
			expect(state.entries.get("cache-new")).toEqual(["path/b"]);
		});

		it("propagates effect errors", async () => {
			const state = ActionCacheTest.empty();
			const failingEffect = Effect.fail("boom" as const);
			const exit = await runExit(state, withCache("my-key", ["path/a"], failingEffect));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("ActionCacheError", () => {
		it("is a tagged error with correct fields", () => {
			const error = new ActionCacheError({
				key: "my-key",
				operation: "save",
				reason: "something broke",
			});
			expect(error._tag).toBe("ActionCacheError");
			expect(error.key).toBe("my-key");
			expect(error.operation).toBe("save");
			expect(error.reason).toBe("something broke");
		});

		it("supports restore operation", () => {
			const error = new ActionCacheError({
				key: "other-key",
				operation: "restore",
				reason: "network error",
			});
			expect(error._tag).toBe("ActionCacheError");
			expect(error.operation).toBe("restore");
		});
	});
});
