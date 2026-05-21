import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PathUtils } from "./PathUtils.js";

describe("PathUtils", () => {
	describe("toPosixPath", () => {
		it("converts backslashes to slashes", () => {
			expect(PathUtils.toPosixPath("a\\b\\c")).toBe("a/b/c");
		});

		it("leaves forward slashes unchanged", () => {
			expect(PathUtils.toPosixPath("a/b/c")).toBe("a/b/c");
		});
	});

	describe("toWin32Path", () => {
		it("converts slashes to backslashes", () => {
			expect(PathUtils.toWin32Path("a/b/c")).toBe("a\\b\\c");
		});

		it("leaves backslashes unchanged", () => {
			expect(PathUtils.toWin32Path("a\\b\\c")).toBe("a\\b\\c");
		});
	});

	describe("toPlatformPath", () => {
		it("normalizes both separators to the platform separator", () => {
			expect(PathUtils.toPlatformPath("a/b\\c")).toBe(["a", "b", "c"].join(sep));
		});
	});
});
