import { getState, saveState } from "@actions/core";
import { Effect, Option, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ActionState } from "../services/ActionState.js";
import { ActionStateLive } from "./ActionStateLive.js";

vi.mock("@actions/core", () => ({
	saveState: vi.fn(),
	getState: vi.fn(),
}));

const run = <A, E>(effect: Effect.Effect<A, E, ActionState>) =>
	Effect.runPromise(Effect.provide(effect, ActionStateLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, ActionState>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionStateLive)));

const TestSchema = Schema.Struct({
	token: Schema.String,
	count: Schema.Number,
});

describe("ActionStateLive", () => {
	describe("save", () => {
		it("encodes and calls core.saveState", async () => {
			await run(Effect.flatMap(ActionState, (svc) => svc.save("auth", { token: "abc", count: 1 }, TestSchema)));
			expect(saveState).toHaveBeenCalledWith("auth", JSON.stringify({ token: "abc", count: 1 }));
		});

		it("encodes Date via Schema.DateFromString", async () => {
			const date = new Date("2026-01-15T00:00:00.000Z");
			await run(Effect.flatMap(ActionState, (svc) => svc.save("started", date, Schema.DateFromString)));
			expect(saveState).toHaveBeenCalledWith("started", JSON.stringify("2026-01-15T00:00:00.000Z"));
		});
	});

	describe("get", () => {
		it("reads and decodes state", async () => {
			vi.mocked(getState).mockReturnValue(JSON.stringify({ token: "xyz", count: 42 }));
			const result = await run(Effect.flatMap(ActionState, (svc) => svc.get("auth", TestSchema)));
			expect(result).toEqual({ token: "xyz", count: 42 });
			expect(getState).toHaveBeenCalledWith("auth");
		});

		it("decodes DateFromString", async () => {
			vi.mocked(getState).mockReturnValue(JSON.stringify("2026-01-15T00:00:00.000Z"));
			const result = await run(Effect.flatMap(ActionState, (svc) => svc.get("started", Schema.DateFromString)));
			expect(result).toBeInstanceOf(Date);
			expect(result.toISOString()).toBe("2026-01-15T00:00:00.000Z");
		});

		it("fails on empty state (not set)", async () => {
			vi.mocked(getState).mockReturnValue("");
			const exit = await runExit(Effect.flatMap(ActionState, (svc) => svc.get("missing", TestSchema)));
			expect(exit._tag).toBe("Failure");
		});

		it("fails on invalid JSON", async () => {
			vi.mocked(getState).mockReturnValue("not-json");
			const exit = await runExit(Effect.flatMap(ActionState, (svc) => svc.get("bad", TestSchema)));
			expect(exit._tag).toBe("Failure");
		});

		it("fails on schema mismatch", async () => {
			vi.mocked(getState).mockReturnValue(JSON.stringify({ wrong: "shape" }));
			const exit = await runExit(Effect.flatMap(ActionState, (svc) => svc.get("auth", TestSchema)));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getOptional", () => {
		it("returns Some for present state", async () => {
			vi.mocked(getState).mockReturnValue(JSON.stringify({ token: "abc", count: 1 }));
			const result = await run(Effect.flatMap(ActionState, (svc) => svc.getOptional("auth", TestSchema)));
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value).toEqual({ token: "abc", count: 1 });
			}
		});

		it("returns None for empty state", async () => {
			vi.mocked(getState).mockReturnValue("");
			const result = await run(Effect.flatMap(ActionState, (svc) => svc.getOptional("missing", TestSchema)));
			expect(Option.isNone(result)).toBe(true);
		});

		it("fails on invalid JSON", async () => {
			vi.mocked(getState).mockReturnValue("bad-json");
			const exit = await runExit(Effect.flatMap(ActionState, (svc) => svc.getOptional("bad", TestSchema)));
			expect(exit._tag).toBe("Failure");
		});
	});
});
