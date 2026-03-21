import { Effect, Option } from "effect";
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

// -- Service method shorthands --

const save = (paths: ReadonlyArray<string>, key: string) => Effect.flatMap(ActionCache, (svc) => svc.save(paths, key));

const restore = (paths: ReadonlyArray<string>, primaryKey: string, restoreKeys?: ReadonlyArray<string>) =>
	Effect.flatMap(ActionCache, (svc) => svc.restore(paths, primaryKey, restoreKeys));

describe("ActionCache", () => {
	describe("save", () => {
		it("stores entry in test state", async () => {
			const state = ActionCacheTest.empty();
			await run(state, save(["path/a", "path/b"], "my-key"));
			expect(state.entries.has("my-key")).toBe(true);
			expect(state.entries.get("my-key")).toEqual(["path/a", "path/b"]);
		});

		it("overwrites existing entry with same key", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("my-key", ["old/path"]);
			await run(state, save(["new/path"], "my-key"));
			expect(state.entries.get("my-key")).toEqual(["new/path"]);
		});
	});

	describe("restore", () => {
		it("returns Some on exact key match", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("my-key", ["path/a"]);
			const result = await run(state, restore(["path/a"], "my-key"));
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value).toBe("my-key");
			}
		});

		it("returns Some on restore key prefix match", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("cache-abc123", ["path/a"]);
			const result = await run(state, restore(["path/a"], "cache-xyz", ["cache-"]));
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value).toBe("cache-abc123");
			}
		});

		it("returns None on unknown key", async () => {
			const state = ActionCacheTest.empty();
			const result = await run(state, restore(["path/a"], "missing-key"));
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns None when no restore keys match", async () => {
			const state = ActionCacheTest.empty();
			state.entries.set("other-key", ["path/a"]);
			const result = await run(state, restore(["path/a"], "missing", ["no-match-"]));
			expect(Option.isNone(result)).toBe(true);
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
