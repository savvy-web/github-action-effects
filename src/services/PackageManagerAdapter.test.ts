import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { PackageManagerAdapterTest } from "../layers/PackageManagerAdapterTest.js";
import { PackageManagerAdapter } from "./PackageManagerAdapter.js";

const provide = <A, E>(
	state: ReturnType<typeof PackageManagerAdapterTest.empty>,
	effect: Effect.Effect<A, E, PackageManagerAdapter>,
) => Effect.provide(effect, PackageManagerAdapterTest.layer(state));

const run = <A, E>(
	state: ReturnType<typeof PackageManagerAdapterTest.empty>,
	effect: Effect.Effect<A, E, PackageManagerAdapter>,
) => Effect.runPromise(provide(state, effect));

describe("PackageManagerAdapter", () => {
	describe("detect", () => {
		it("returns configured info", async () => {
			const state = PackageManagerAdapterTest.empty();

			const result = await run(
				state,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.detect()),
			);
			expect(result).toEqual({ name: "pnpm", version: "9.0.0", lockfile: "pnpm-lock.yaml" });
		});

		it("returns custom info when configured", async () => {
			const state: ReturnType<typeof PackageManagerAdapterTest.empty> = {
				info: { name: "yarn", version: "4.0.0", lockfile: "yarn.lock" },
				execCalls: [],
				cachePaths: ["/mock/yarn-cache"],
			};

			const result = await run(
				state,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.detect()),
			);
			expect(result.name).toBe("yarn");
			expect(result.version).toBe("4.0.0");
		});
	});

	describe("install", () => {
		it("completes without error", async () => {
			const state = PackageManagerAdapterTest.empty();

			await run(
				state,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.install()),
			);
		});
	});

	describe("getCachePaths", () => {
		it("returns configured paths", async () => {
			const state = PackageManagerAdapterTest.empty();

			const result = await run(
				state,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.getCachePaths()),
			);
			expect(result).toEqual(["/mock/cache"]);
		});
	});

	describe("getLockfilePaths", () => {
		it("returns correct lockfiles for pnpm", async () => {
			const state = PackageManagerAdapterTest.empty();

			const result = await run(
				state,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.getLockfilePaths()),
			);
			expect(result).toEqual(["pnpm-lock.yaml"]);
		});

		it("returns correct lockfiles for npm", async () => {
			const state: ReturnType<typeof PackageManagerAdapterTest.empty> = {
				info: { name: "npm", version: "10.0.0", lockfile: "package-lock.json" },
				execCalls: [],
				cachePaths: [],
			};

			const result = await run(
				state,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.getLockfilePaths()),
			);
			expect(result).toEqual(["package-lock.json"]);
		});

		it("returns correct lockfiles for bun", async () => {
			const state: ReturnType<typeof PackageManagerAdapterTest.empty> = {
				info: { name: "bun", version: "1.0.0", lockfile: "bun.lockb" },
				execCalls: [],
				cachePaths: [],
			};

			const result = await run(
				state,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.getLockfilePaths()),
			);
			expect(result).toEqual(["bun.lockb", "bun.lock"]);
		});
	});

	describe("exec", () => {
		it("records the call and returns output", async () => {
			const state = PackageManagerAdapterTest.empty();

			const result = await run(
				state,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.exec(["run", "build"])),
			);
			expect(result.exitCode).toBe(0);
			expect(state.execCalls).toHaveLength(1);
			expect(state.execCalls[0].args).toEqual(["run", "build"]);
		});

		it("records options when provided", async () => {
			const state = PackageManagerAdapterTest.empty();

			await run(
				state,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.exec(["test"], { cwd: "/app" })),
			);
			expect(state.execCalls[0].options).toEqual({ cwd: "/app" });
		});
	});
});
