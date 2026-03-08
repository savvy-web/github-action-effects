import { restoreCache, saveCache } from "@actions/cache";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionCache } from "../services/ActionCache.js";
import { ActionCacheLive } from "./ActionCacheLive.js";

vi.mock("@actions/cache", () => ({
	saveCache: vi.fn(),
	restoreCache: vi.fn(),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

const run = <A, E>(effect: Effect.Effect<A, E, ActionCache>) =>
	Effect.runPromise(Effect.provide(effect, ActionCacheLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, ActionCache>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionCacheLive)));

describe("ActionCacheLive", () => {
	describe("save", () => {
		it("calls saveCache with key and paths", async () => {
			vi.mocked(saveCache).mockResolvedValue(1);
			await run(Effect.flatMap(ActionCache, (svc) => svc.save("my-key", ["node_modules"])));
			expect(saveCache).toHaveBeenCalledWith(["node_modules"], "my-key");
		});

		it("fails when saveCache rejects", async () => {
			vi.mocked(saveCache).mockRejectedValue(new Error("save error"));
			const exit = await runExit(Effect.flatMap(ActionCache, (svc) => svc.save("key", ["path"])));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("restore", () => {
		it("returns hit when cache found", async () => {
			vi.mocked(restoreCache).mockResolvedValue("my-key");
			const result = await run(Effect.flatMap(ActionCache, (svc) => svc.restore("my-key", ["path"])));
			expect(result.hit).toBe(true);
			expect(result.matchedKey).toBe("my-key");
		});

		it("returns miss when cache not found", async () => {
			vi.mocked(restoreCache).mockResolvedValue(undefined);
			const result = await run(Effect.flatMap(ActionCache, (svc) => svc.restore("key", ["path"])));
			expect(result.hit).toBe(false);
			expect(result.matchedKey).toBeUndefined();
		});

		it("passes restore keys", async () => {
			vi.mocked(restoreCache).mockResolvedValue("prefix-abc");
			await run(Effect.flatMap(ActionCache, (svc) => svc.restore("exact-key", ["path"], ["prefix-"])));
			expect(restoreCache).toHaveBeenCalledWith(["path"], "exact-key", ["prefix-"]);
		});
	});

	describe("withCache", () => {
		it("skips save on exact hit", async () => {
			vi.mocked(restoreCache).mockResolvedValue("key");
			const result = await run(
				Effect.flatMap(ActionCache, (svc) => svc.withCache("key", ["path"], Effect.succeed("done"))),
			);
			expect(result).toBe("done");
			expect(saveCache).not.toHaveBeenCalled();
		});

		it("saves on cache miss", async () => {
			vi.mocked(restoreCache).mockResolvedValue(undefined);
			vi.mocked(saveCache).mockResolvedValue(1);
			const result = await run(
				Effect.flatMap(ActionCache, (svc) => svc.withCache("key", ["path"], Effect.succeed("done"))),
			);
			expect(result).toBe("done");
			expect(saveCache).toHaveBeenCalledWith(["path"], "key");
		});
	});
});
