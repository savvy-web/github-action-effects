import type { Context } from "effect";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ActionCache } from "../services/ActionCache.js";
import { ActionsCache } from "../services/ActionsCache.js";
import { ActionCacheLive } from "./ActionCacheLive.js";

const mockActionsCache = (overrides: Partial<Context.Tag.Service<typeof ActionsCache>> = {}) =>
	Layer.succeed(ActionsCache, {
		saveCache: vi.fn().mockResolvedValue(1),
		restoreCache: vi.fn().mockResolvedValue(undefined),
		...overrides,
	});

const run = <A, E>(
	effect: Effect.Effect<A, E, ActionCache>,
	cacheOverrides: Partial<Context.Tag.Service<typeof ActionsCache>> = {},
) => Effect.runPromise(Effect.provide(effect, ActionCacheLive.pipe(Layer.provide(mockActionsCache(cacheOverrides)))));

const runExit = <A, E>(
	effect: Effect.Effect<A, E, ActionCache>,
	cacheOverrides: Partial<Context.Tag.Service<typeof ActionsCache>> = {},
) =>
	Effect.runPromise(
		Effect.exit(Effect.provide(effect, ActionCacheLive.pipe(Layer.provide(mockActionsCache(cacheOverrides))))),
	);

describe("ActionCacheLive", () => {
	describe("save", () => {
		it("calls saveCache with key and paths", async () => {
			const saveCache = vi.fn().mockResolvedValue(1);
			await run(
				Effect.flatMap(ActionCache, (svc) => svc.save("my-key", ["node_modules"])),
				{ saveCache },
			);
			expect(saveCache).toHaveBeenCalledWith(["node_modules"], "my-key");
		});

		it("fails when saveCache rejects", async () => {
			const saveCache = vi.fn().mockRejectedValue(new Error("save error"));
			const exit = await runExit(
				Effect.flatMap(ActionCache, (svc) => svc.save("key", ["path"])),
				{ saveCache },
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("restore", () => {
		it("returns hit when cache found", async () => {
			const restoreCache = vi.fn().mockResolvedValue("my-key");
			const result = await run(
				Effect.flatMap(ActionCache, (svc) => svc.restore("my-key", ["path"])),
				{
					restoreCache,
				},
			);
			expect(result.hit).toBe(true);
			expect(result.matchedKey).toBe("my-key");
		});

		it("returns miss when cache not found", async () => {
			const restoreCache = vi.fn().mockResolvedValue(undefined);
			const result = await run(
				Effect.flatMap(ActionCache, (svc) => svc.restore("key", ["path"])),
				{ restoreCache },
			);
			expect(result.hit).toBe(false);
			expect(result.matchedKey).toBeUndefined();
		});

		it("passes restore keys", async () => {
			const restoreCache = vi.fn().mockResolvedValue("prefix-abc");
			await run(
				Effect.flatMap(ActionCache, (svc) => svc.restore("exact-key", ["path"], ["prefix-"])),
				{
					restoreCache,
				},
			);
			expect(restoreCache).toHaveBeenCalledWith(["path"], "exact-key", ["prefix-"]);
		});
	});

	describe("withCache", () => {
		it("skips save on exact hit", async () => {
			const saveCache = vi.fn().mockResolvedValue(1);
			const restoreCache = vi.fn().mockResolvedValue("key");
			const result = await run(
				Effect.flatMap(ActionCache, (svc) => svc.withCache("key", ["path"], Effect.succeed("done"))),
				{ saveCache, restoreCache },
			);
			expect(result).toBe("done");
			expect(saveCache).not.toHaveBeenCalled();
		});

		it("saves on cache miss", async () => {
			const saveCache = vi.fn().mockResolvedValue(1);
			const restoreCache = vi.fn().mockResolvedValue(undefined);
			const result = await run(
				Effect.flatMap(ActionCache, (svc) => svc.withCache("key", ["path"], Effect.succeed("done"))),
				{ saveCache, restoreCache },
			);
			expect(result).toBe("done");
			expect(saveCache).toHaveBeenCalledWith(["path"], "key");
		});
	});
});
