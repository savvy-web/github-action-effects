import { describe, expect, it } from "vitest";
import { resolveLogLevel } from "./LogLevel.js";

describe("resolveLogLevel", () => {
	it("returns info for auto when RUNNER_DEBUG is not set", () => {
		const original = process.env.RUNNER_DEBUG;
		delete process.env.RUNNER_DEBUG;
		try {
			expect(resolveLogLevel("auto")).toBe("info");
		} finally {
			if (original !== undefined) {
				process.env.RUNNER_DEBUG = original;
			} else {
				delete process.env.RUNNER_DEBUG;
			}
		}
	});

	it("returns debug for auto when RUNNER_DEBUG is 1", () => {
		const original = process.env.RUNNER_DEBUG;
		process.env.RUNNER_DEBUG = "1";
		try {
			expect(resolveLogLevel("auto")).toBe("debug");
		} finally {
			if (original !== undefined) {
				process.env.RUNNER_DEBUG = original;
			} else {
				delete process.env.RUNNER_DEBUG;
			}
		}
	});

	it("passes through explicit levels", () => {
		expect(resolveLogLevel("info")).toBe("info");
		expect(resolveLogLevel("verbose")).toBe("verbose");
		expect(resolveLogLevel("debug")).toBe("debug");
	});
});
