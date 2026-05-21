import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(),
		globSync: vi.fn(),
	};
});

import { existsSync, globSync } from "node:fs";
import { resolvePaths } from "./globPaths.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedGlobSync = vi.mocked(globSync);

describe("globPaths.resolvePaths", () => {
	beforeEach(() => {
		vi.stubEnv("HOME", "/home/runner");
		mockedExistsSync.mockReturnValue(true);
		mockedGlobSync.mockImplementation((pattern) => [pattern] as unknown as string[]);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it("expands ~/ to HOME", () => {
		const result = resolvePaths(["~/.cache/deno"]);
		expect(result).toContain("/home/runner/.cache/deno");
		expect(result).not.toContain("~/.cache/deno");
	});

	it("expands a bare ~ to HOME", () => {
		const result = resolvePaths(["~"]);
		expect(result).toEqual(["/home/runner"]);
	});

	it("expands absolute glob via globSync", () => {
		mockedGlobSync.mockReturnValueOnce(["/opt/a/file1", "/opt/a/file2"] as unknown as string[]);
		const result = resolvePaths(["/opt/a/*"]);
		expect(mockedGlobSync).toHaveBeenCalledWith("/opt/a/*");
		expect(result).toContain("/opt/a/file1");
		expect(result).toContain("/opt/a/file2");
	});

	it("keeps literal (non-glob) paths verbatim", () => {
		const result = resolvePaths(["/opt/real-path"]);
		expect(mockedGlobSync).not.toHaveBeenCalled();
		expect(result).toEqual(["/opt/real-path"]);
	});

	it("filters non-existent paths", () => {
		mockedExistsSync.mockImplementation((p) => p !== "/home/runner/.bun/install/cache");
		const result = resolvePaths(["~/.bun/install/cache", "/opt/real-path"]);
		expect(result).toContain("/opt/real-path");
		expect(result).not.toContain("/home/runner/.bun/install/cache");
	});

	it("dedups child paths covered by a listed parent", () => {
		const result = resolvePaths(["/opt/parent", "/opt/parent/child"]);
		expect(result).toEqual(["/opt/parent"]);
	});
});
