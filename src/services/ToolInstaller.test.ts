import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { ToolInstallerTest } from "../layers/ToolInstallerTest.js";
import { ToolInstaller } from "./ToolInstaller.js";

const run = <A, E>(state: ReturnType<typeof ToolInstallerTest.empty>, effect: Effect.Effect<A, E, ToolInstaller>) =>
	Effect.runPromise(Effect.provide(effect, ToolInstallerTest.layer(state)));

describe("ToolInstaller", () => {
	describe("find", () => {
		it("returns Option.none() for uncached tools", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.find("node", "20.0.0")),
			);

			expect(Option.isNone(result)).toBe(true);
			expect(state.findCalls).toHaveLength(1);
			expect(state.findCalls[0]).toEqual({ tool: "node", version: "20.0.0" });
		});

		it("returns Option.some(path) for cached tools", async () => {
			const state = ToolInstallerTest.empty();
			state.cachedTools.set("node@20.0.0", "/tools/node/20.0.0");

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.find("node", "20.0.0")),
			);

			expect(Option.isSome(result)).toBe(true);
			expect(Option.getOrThrow(result)).toBe("/tools/node/20.0.0");
		});
	});

	describe("download", () => {
		it("records the download call and returns a path", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.download("https://example.com/tool.tar.gz")),
			);

			expect(result).toContain("tool.tar.gz");
			expect(state.downloadCalls).toHaveLength(1);
			expect(state.downloadCalls[0]).toEqual({ url: "https://example.com/tool.tar.gz" });
		});
	});

	describe("extractTar", () => {
		it("records call and returns destination", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.extractTar("/tmp/archive.tar.gz", "/tmp/out")),
			);

			expect(result).toBe("/tmp/out");
			expect(state.extractTarCalls).toHaveLength(1);
			expect(state.extractTarCalls[0]).toEqual({ file: "/tmp/archive.tar.gz", dest: "/tmp/out" });
		});

		it("generates a path when dest is omitted", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.extractTar("/tmp/archive.tar.gz")),
			);

			expect(result).toContain("archive.tar.gz");
			expect(state.extractTarCalls).toHaveLength(1);
		});
	});

	describe("extractZip", () => {
		it("records call and returns destination", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.extractZip("/tmp/archive.zip", "/tmp/out")),
			);

			expect(result).toBe("/tmp/out");
			expect(state.extractZipCalls).toHaveLength(1);
			expect(state.extractZipCalls[0]).toEqual({ file: "/tmp/archive.zip", dest: "/tmp/out" });
		});
	});

	describe("cacheDir", () => {
		it("records call and returns cached path", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.cacheDir("/tmp/extracted", "node", "20.0.0")),
			);

			expect(result).toBe("/tools/node/20.0.0");
			expect(state.cacheDirCalls).toHaveLength(1);
			expect(state.cacheDirCalls[0]).toEqual({ sourceDir: "/tmp/extracted", tool: "node", version: "20.0.0" });
		});

		it("adds tool to cached tools", async () => {
			const state = ToolInstallerTest.empty();

			await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.cacheDir("/tmp/extracted", "node", "20.0.0")),
			);

			expect(state.cachedTools.has("node@20.0.0")).toBe(true);
		});
	});

	describe("cacheFile", () => {
		it("records call and returns cached path", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.cacheFile("/tmp/biome", "biome", "biome", "1.0.0")),
			);

			expect(result).toBe("/tools/biome/1.0.0");
			expect(state.cacheFileCalls).toHaveLength(1);
			expect(state.cacheFileCalls[0]).toEqual({
				sourceFile: "/tmp/biome",
				targetFile: "biome",
				tool: "biome",
				version: "1.0.0",
			});
		});

		it("adds tool to cached tools", async () => {
			const state = ToolInstallerTest.empty();

			await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.cacheFile("/tmp/biome", "biome", "biome", "1.0.0")),
			);

			expect(state.cachedTools.has("biome@1.0.0")).toBe(true);
		});
	});
});
