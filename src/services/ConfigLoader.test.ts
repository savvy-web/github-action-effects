import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { ConfigLoaderError } from "../errors/ConfigLoaderError.js";
import { ConfigLoaderTest } from "../layers/ConfigLoaderTest.js";
import { ConfigLoader } from "./ConfigLoader.js";

const TestConfig = Schema.Struct({
	name: Schema.String,
	version: Schema.Number,
});

const provide = <A, E>(state: ReturnType<typeof ConfigLoaderTest.empty>, effect: Effect.Effect<A, E, ConfigLoader>) =>
	Effect.provide(effect, ConfigLoaderTest.layer(state));

const run = <A, E>(state: ReturnType<typeof ConfigLoaderTest.empty>, effect: Effect.Effect<A, E, ConfigLoader>) =>
	Effect.runPromise(provide(state, effect));

const runFail = <A>(
	state: ReturnType<typeof ConfigLoaderTest.empty>,
	effect: Effect.Effect<A, ConfigLoaderError, ConfigLoader>,
) => Effect.runPromise(Effect.flip(provide(state, effect)));

describe("ConfigLoader", () => {
	describe("loadJson", () => {
		it("returns parsed and validated result", async () => {
			const state = ConfigLoaderTest.empty();
			state.files.set("/config.json", JSON.stringify({ name: "test", version: 1 }));

			const result = await run(
				state,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJson("/config.json", TestConfig)),
			);
			expect(result).toEqual({ name: "test", version: 1 });
		});

		it("fails with validate error on schema mismatch", async () => {
			const state = ConfigLoaderTest.empty();
			state.files.set("/config.json", JSON.stringify({ name: "test", version: "not-a-number" }));

			const error = await runFail(
				state,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJson("/config.json", TestConfig)),
			);
			expect(error.operation).toBe("validate");
			expect(error.path).toBe("/config.json");
		});

		it("fails with read error when file not found", async () => {
			const state = ConfigLoaderTest.empty();

			const error = await runFail(
				state,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJson("/missing.json", TestConfig)),
			);
			expect(error.operation).toBe("read");
			expect(error.path).toBe("/missing.json");
		});

		it("fails with parse error on invalid JSON", async () => {
			const state = ConfigLoaderTest.empty();
			state.files.set("/bad.json", "{ invalid json }");

			const error = await runFail(
				state,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJson("/bad.json", TestConfig)),
			);
			expect(error.operation).toBe("parse");
			expect(error.path).toBe("/bad.json");
		});
	});

	describe("loadJsonc", () => {
		it("returns parsed result with comments stripped", async () => {
			const state = ConfigLoaderTest.empty();
			state.files.set(
				"/config.jsonc",
				`{
  // This is a comment
  "name": "test",
  "version": 2
}`,
			);

			const result = await run(
				state,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJsonc("/config.jsonc", TestConfig)),
			);
			expect(result).toEqual({ name: "test", version: 2 });
		});
	});

	describe("loadYaml", () => {
		it("returns parsed and validated result", async () => {
			const state = ConfigLoaderTest.empty();
			state.files.set("/config.yaml", "name: myapp\nversion: 3");

			const result = await run(
				state,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadYaml("/config.yaml", TestConfig)),
			);
			expect(result).toEqual({ name: "myapp", version: 3 });
		});
	});

	describe("exists", () => {
		it("returns true when file exists", async () => {
			const state = ConfigLoaderTest.empty();
			state.files.set("/config.json", "{}");

			const result = await run(
				state,
				Effect.flatMap(ConfigLoader, (svc) => svc.exists("/config.json")),
			);
			expect(result).toBe(true);
		});

		it("returns false when file does not exist", async () => {
			const state = ConfigLoaderTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ConfigLoader, (svc) => svc.exists("/missing.json")),
			);
			expect(result).toBe(false);
		});
	});
});
