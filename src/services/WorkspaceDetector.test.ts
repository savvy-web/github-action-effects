import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspaceDetectorTest } from "../layers/WorkspaceDetectorTest.js";
import { WorkspaceDetector } from "./WorkspaceDetector.js";

describe("WorkspaceDetector", () => {
	it("detect returns workspace info", async () => {
		const layer = WorkspaceDetectorTest.layer({
			info: { root: ".", type: "pnpm", patterns: ["packages/*"] },
			packages: [],
		});
		const result = await Effect.runPromise(
			WorkspaceDetector.pipe(
				Effect.flatMap((wd) => wd.detect()),
				Effect.provide(layer),
			),
		);
		expect(result.type).toBe("pnpm");
		expect(result.patterns).toEqual(["packages/*"]);
	});

	it("detect returns single for non-monorepo", async () => {
		const layer = WorkspaceDetectorTest.empty();
		const result = await Effect.runPromise(
			WorkspaceDetector.pipe(
				Effect.flatMap((wd) => wd.detect()),
				Effect.provide(layer),
			),
		);
		expect(result.type).toBe("single");
	});

	it("listPackages returns all packages", async () => {
		const layer = WorkspaceDetectorTest.layer({
			info: { root: ".", type: "pnpm", patterns: ["packages/*"] },
			packages: [
				{ name: "@scope/a", version: "1.0.0", path: "packages/a", private: false, dependencies: {} },
				{
					name: "@scope/b",
					version: "2.0.0",
					path: "packages/b",
					private: true,
					dependencies: { "@scope/a": "^1.0.0" },
				},
			],
		});
		const result = await Effect.runPromise(
			WorkspaceDetector.pipe(
				Effect.flatMap((wd) => wd.listPackages()),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveLength(2);
		expect(result[0]?.name).toBe("@scope/a");
	});

	it("getPackage finds by name", async () => {
		const layer = WorkspaceDetectorTest.layer({
			info: { root: ".", type: "npm", patterns: ["packages/*"] },
			packages: [{ name: "my-pkg", version: "1.0.0", path: "packages/my-pkg", private: false, dependencies: {} }],
		});
		const result = await Effect.runPromise(
			WorkspaceDetector.pipe(
				Effect.flatMap((wd) => wd.getPackage("my-pkg")),
				Effect.provide(layer),
			),
		);
		expect(result.name).toBe("my-pkg");
	});

	it("getPackage finds by path", async () => {
		const layer = WorkspaceDetectorTest.layer({
			info: { root: ".", type: "npm", patterns: ["packages/*"] },
			packages: [{ name: "my-pkg", version: "1.0.0", path: "packages/my-pkg", private: false, dependencies: {} }],
		});
		const result = await Effect.runPromise(
			WorkspaceDetector.pipe(
				Effect.flatMap((wd) => wd.getPackage("packages/my-pkg")),
				Effect.provide(layer),
			),
		);
		expect(result.name).toBe("my-pkg");
	});

	it("getPackage fails for unknown package", async () => {
		const layer = WorkspaceDetectorTest.empty();
		const exit = await Effect.runPromiseExit(
			WorkspaceDetector.pipe(
				Effect.flatMap((wd) => wd.getPackage("nonexistent")),
				Effect.provide(layer),
			),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});
});
