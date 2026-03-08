import { FileSystem } from "@effect/platform";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { ConfigLoaderError } from "../errors/ConfigLoaderError.js";
import { ConfigLoader } from "../services/ConfigLoader.js";
import { ConfigLoaderLive } from "./ConfigLoaderLive.js";

// -- Test Schema --

const TestConfig = Schema.Struct({
	name: Schema.String,
	version: Schema.Number,
});

// -- Mock FileSystem --

interface MockFileEntry {
	readonly content: string;
}

const makeMockFs = (files: Record<string, MockFileEntry>): FileSystem.FileSystem => {
	return {
		readFileString: (path: string) => {
			const entry = files[path];
			if (!entry) {
				return Effect.fail({ _tag: "SystemError", message: `File not found: ${path}` } as never);
			}
			return Effect.succeed(entry.content);
		},

		access: (path: string) => {
			if (!files[path]) {
				return Effect.fail({ _tag: "SystemError", message: `File not found: ${path}` } as never);
			}
			return Effect.void;
		},

		// Stub all other methods to satisfy the interface
		readDirectory: () => Effect.succeed([]),
		writeFileString: () => Effect.void,
		chmod: () => Effect.void,
		chown: () => Effect.void,
		copy: () => Effect.void,
		copyFile: () => Effect.void,
		exists: () => Effect.succeed(true),
		link: () => Effect.void,
		makeDirectory: () => Effect.void,
		makeTempDirectory: () => Effect.succeed("/tmp/test"),
		makeTempDirectoryScoped: () => Effect.succeed("/tmp/test"),
		makeTempFile: () => Effect.succeed("/tmp/test-file"),
		makeTempFileScoped: () => Effect.succeed("/tmp/test-file"),
		open: () => Effect.die("not implemented"),
		readFile: () => Effect.die("not implemented"),
		readLink: () => Effect.succeed("/tmp"),
		realPath: () => Effect.succeed("/tmp"),
		remove: () => Effect.void,
		rename: () => Effect.void,
		sink: () => Effect.die("not implemented") as never,
		stat: () => Effect.die("not implemented"),
		stream: () => Effect.die("not implemented") as never,
		symlink: () => Effect.void,
		truncate: () => Effect.void,
		utimes: () => Effect.void,
		watch: () => Effect.die("not implemented") as never,
		writeFile: () => Effect.void,
	} as unknown as FileSystem.FileSystem;
};

const makeTestLayer = (files: Record<string, MockFileEntry>) =>
	Layer.provide(ConfigLoaderLive, Layer.succeed(FileSystem.FileSystem, makeMockFs(files)));

const run = <A, E>(files: Record<string, MockFileEntry>, effect: Effect.Effect<A, E, ConfigLoader>) =>
	Effect.runPromise(Effect.provide(effect, makeTestLayer(files)));

const runFail = <A>(files: Record<string, MockFileEntry>, effect: Effect.Effect<A, ConfigLoaderError, ConfigLoader>) =>
	Effect.runPromise(Effect.flip(Effect.provide(effect, makeTestLayer(files))));

describe("ConfigLoaderLive", () => {
	describe("loadJson", () => {
		it("reads, parses, and validates a JSON file", async () => {
			const files = {
				"/app/config.json": { content: JSON.stringify({ name: "myapp", version: 1 }) },
			};

			const result = await run(
				files,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJson("/app/config.json", TestConfig)),
			);
			expect(result).toEqual({ name: "myapp", version: 1 });
		});

		it("fails with read error for missing file", async () => {
			const error = await runFail(
				{},
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJson("/missing.json", TestConfig)),
			);
			expect(error.operation).toBe("read");
			expect(error.path).toBe("/missing.json");
		});

		it("fails with parse error for invalid JSON", async () => {
			const files = {
				"/bad.json": { content: "not valid json {" },
			};

			const error = await runFail(
				files,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJson("/bad.json", TestConfig)),
			);
			expect(error.operation).toBe("parse");
			expect(error.path).toBe("/bad.json");
		});

		it("fails with validate error for schema mismatch", async () => {
			const files = {
				"/wrong.json": { content: JSON.stringify({ name: 123, version: "bad" }) },
			};

			const error = await runFail(
				files,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJson("/wrong.json", TestConfig)),
			);
			expect(error.operation).toBe("validate");
			expect(error.path).toBe("/wrong.json");
		});
	});

	describe("loadJsonc", () => {
		it("reads, parses, and validates a JSONC file with comments", async () => {
			const jsoncContent = [
				"// This is a comment",
				"{",
				'  "name": "myapp", // inline comment',
				'  "version": 2',
				"}",
			].join("\n");

			const files = {
				"/app/config.jsonc": { content: jsoncContent },
			};

			const result = await run(
				files,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJsonc("/app/config.jsonc", TestConfig)),
			);
			expect(result).toEqual({ name: "myapp", version: 2 });
		});

		it("fails with read error for missing file", async () => {
			const error = await runFail(
				{},
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJsonc("/missing.jsonc", TestConfig)),
			);
			expect(error.operation).toBe("read");
			expect(error.path).toBe("/missing.jsonc");
		});

		it("fails with validate error for schema mismatch", async () => {
			const files = {
				"/wrong.jsonc": { content: '{ "name": 123, "version": "bad" }' },
			};

			const error = await runFail(
				files,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadJsonc("/wrong.jsonc", TestConfig)),
			);
			expect(error.operation).toBe("validate");
			expect(error.path).toBe("/wrong.jsonc");
		});
	});

	describe("loadYaml", () => {
		it("reads, parses, and validates a YAML file", async () => {
			const yamlContent = ["name: myapp", "version: 3"].join("\n");

			const files = {
				"/app/config.yml": { content: yamlContent },
			};

			const result = await run(
				files,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadYaml("/app/config.yml", TestConfig)),
			);
			expect(result).toEqual({ name: "myapp", version: 3 });
		});

		it("fails with read error for missing file", async () => {
			const error = await runFail(
				{},
				Effect.flatMap(ConfigLoader, (svc) => svc.loadYaml("/missing.yml", TestConfig)),
			);
			expect(error.operation).toBe("read");
			expect(error.path).toBe("/missing.yml");
		});

		it("fails with validate error for schema mismatch", async () => {
			const yamlContent = ["name: 123", "version: bad"].join("\n");

			const files = {
				"/wrong.yml": { content: yamlContent },
			};

			const error = await runFail(
				files,
				Effect.flatMap(ConfigLoader, (svc) => svc.loadYaml("/wrong.yml", TestConfig)),
			);
			expect(error.operation).toBe("validate");
			expect(error.path).toBe("/wrong.yml");
		});
	});

	describe("exists", () => {
		it("returns true when file exists", async () => {
			const files = {
				"/config.json": { content: "{}" },
			};

			const result = await run(
				files,
				Effect.flatMap(ConfigLoader, (svc) => svc.exists("/config.json")),
			);
			expect(result).toBe(true);
		});

		it("returns false when file does not exist", async () => {
			const result = await run(
				{},
				Effect.flatMap(ConfigLoader, (svc) => svc.exists("/missing.json")),
			);
			expect(result).toBe(false);
		});
	});
});
