import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ToolInstallerTest } from "../layers/ToolInstallerTest.js";
import { ToolInstaller } from "./ToolInstaller.js";

const provide = <A, E>(state: ReturnType<typeof ToolInstallerTest.empty>, effect: Effect.Effect<A, E, ToolInstaller>) =>
	Effect.provide(effect, ToolInstallerTest.layer(state));

const run = <A, E>(state: ReturnType<typeof ToolInstallerTest.empty>, effect: Effect.Effect<A, E, ToolInstaller>) =>
	Effect.runPromise(provide(state, effect));

describe("ToolInstaller", () => {
	describe("install", () => {
		it("returns a deterministic path and records in state", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
			);

			expect(result).toBe("/tools/node/20.0.0");
			expect(state.installed).toHaveLength(1);
			expect(state.installed[0]).toEqual({ name: "node", version: "20.0.0", path: "/tools/node/20.0.0" });
		});

		it("appends binSubPath when provided", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("node", "20.0.0", "https://example.com/node.tar.gz", { binSubPath: "bin" }),
				),
			);

			expect(result).toBe("/tools/node/20.0.0/bin");
			expect(state.installed[0]?.path).toBe("/tools/node/20.0.0/bin");
		});

		it("marks tool as cached after install", async () => {
			const state = ToolInstallerTest.empty();

			await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
			);

			const isCached = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.isCached("node", "20.0.0")),
			);
			expect(isCached).toBe(true);
		});
	});

	describe("isCached", () => {
		it("returns true for cached tools", async () => {
			const state = ToolInstallerTest.empty();
			state.cached.add("node@20.0.0");

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.isCached("node", "20.0.0")),
			);
			expect(result).toBe(true);
		});

		it("returns false for uncached tools", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.isCached("node", "20.0.0")),
			);
			expect(result).toBe(false);
		});
	});

	describe("installAndAddToPath", () => {
		it("returns path, records install, and adds to PATH", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
			);

			expect(result).toBe("/tools/node/20.0.0");
			expect(state.installed).toHaveLength(1);
			expect(state.addedToPaths).toEqual(["/tools/node/20.0.0"]);
		});

		it("appends binSubPath and adds correct path", async () => {
			const state = ToolInstallerTest.empty();

			const result = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz", { binSubPath: "bin" }),
				),
			);

			expect(result).toBe("/tools/node/20.0.0/bin");
			expect(state.addedToPaths).toEqual(["/tools/node/20.0.0/bin"]);
		});

		it("marks tool as cached after install", async () => {
			const state = ToolInstallerTest.empty();

			await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
			);

			const isCached = await run(
				state,
				Effect.flatMap(ToolInstaller, (svc) => svc.isCached("node", "20.0.0")),
			);
			expect(isCached).toBe(true);
		});
	});
});
