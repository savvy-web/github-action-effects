import type { Context } from "effect";
import { Effect, Layer, Option, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ActionState } from "../services/ActionState.js";
import { ActionsCore } from "../services/ActionsCore.js";
import { ActionStateLive } from "./ActionStateLive.js";

const mockCore = (overrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {}) =>
	Layer.succeed(ActionsCore, {
		getInput: () => "",
		getMultilineInput: () => [],
		getBooleanInput: () => false,
		setOutput: () => {},
		setFailed: () => {},
		exportVariable: () => {},
		addPath: () => {},
		setSecret: () => {},
		info: () => {},
		debug: () => {},
		warning: () => {},
		error: () => {},
		notice: () => {},
		startGroup: () => {},
		endGroup: () => {},
		getState: () => "",
		saveState: () => {},
		summary: { write: () => Promise.resolve(), addRaw: () => ({ write: () => Promise.resolve() }) },
		...overrides,
	});

const run = <A, E>(
	effect: Effect.Effect<A, E, ActionState>,
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) => Effect.runPromise(Effect.provide(effect, ActionStateLive.pipe(Layer.provide(mockCore(coreOverrides)))));

const runExit = <A, E>(
	effect: Effect.Effect<A, E, ActionState>,
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionStateLive.pipe(Layer.provide(mockCore(coreOverrides))))));

const TestSchema = Schema.Struct({
	token: Schema.String,
	count: Schema.Number,
});

describe("ActionStateLive", () => {
	describe("save", () => {
		it("encodes and calls core.saveState", async () => {
			const saveState = vi.fn();
			await run(
				Effect.flatMap(ActionState, (svc) => svc.save("auth", { token: "abc", count: 1 }, TestSchema)),
				{
					saveState,
				},
			);
			expect(saveState).toHaveBeenCalledWith("auth", JSON.stringify({ token: "abc", count: 1 }));
		});

		it("encodes Date via Schema.DateFromString", async () => {
			const saveState = vi.fn();
			const date = new Date("2026-01-15T00:00:00.000Z");
			await run(
				Effect.flatMap(ActionState, (svc) => svc.save("started", date, Schema.DateFromString)),
				{
					saveState,
				},
			);
			expect(saveState).toHaveBeenCalledWith("started", JSON.stringify("2026-01-15T00:00:00.000Z"));
		});
	});

	describe("get", () => {
		it("reads and decodes state", async () => {
			const getState = vi.fn().mockReturnValue(JSON.stringify({ token: "xyz", count: 42 }));
			const result = await run(
				Effect.flatMap(ActionState, (svc) => svc.get("auth", TestSchema)),
				{ getState },
			);
			expect(result).toEqual({ token: "xyz", count: 42 });
			expect(getState).toHaveBeenCalledWith("auth");
		});

		it("decodes DateFromString", async () => {
			const getState = vi.fn().mockReturnValue(JSON.stringify("2026-01-15T00:00:00.000Z"));
			const result = await run(
				Effect.flatMap(ActionState, (svc) => svc.get("started", Schema.DateFromString)),
				{
					getState,
				},
			);
			expect(result).toBeInstanceOf(Date);
			expect(result.toISOString()).toBe("2026-01-15T00:00:00.000Z");
		});

		it("fails on empty state (not set)", async () => {
			const getState = vi.fn().mockReturnValue("");
			const exit = await runExit(
				Effect.flatMap(ActionState, (svc) => svc.get("missing", TestSchema)),
				{
					getState,
				},
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails on invalid JSON", async () => {
			const getState = vi.fn().mockReturnValue("not-json");
			const exit = await runExit(
				Effect.flatMap(ActionState, (svc) => svc.get("bad", TestSchema)),
				{ getState },
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails on schema mismatch", async () => {
			const getState = vi.fn().mockReturnValue(JSON.stringify({ wrong: "shape" }));
			const exit = await runExit(
				Effect.flatMap(ActionState, (svc) => svc.get("auth", TestSchema)),
				{ getState },
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getOptional", () => {
		it("returns Some for present state", async () => {
			const getState = vi.fn().mockReturnValue(JSON.stringify({ token: "abc", count: 1 }));
			const result = await run(
				Effect.flatMap(ActionState, (svc) => svc.getOptional("auth", TestSchema)),
				{
					getState,
				},
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value).toEqual({ token: "abc", count: 1 });
			}
		});

		it("returns None for empty state", async () => {
			const getState = vi.fn().mockReturnValue("");
			const result = await run(
				Effect.flatMap(ActionState, (svc) => svc.getOptional("missing", TestSchema)),
				{
					getState,
				},
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("fails on invalid JSON", async () => {
			const getState = vi.fn().mockReturnValue("bad-json");
			const exit = await runExit(
				Effect.flatMap(ActionState, (svc) => svc.getOptional("bad", TestSchema)),
				{
					getState,
				},
			);
			expect(exit._tag).toBe("Failure");
		});
	});
});
