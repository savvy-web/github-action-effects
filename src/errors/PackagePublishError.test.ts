import { describe, expect, it } from "vitest";
import { PackagePublishError } from "./PackagePublishError.js";

describe("PackagePublishError", () => {
	it("preserves _tag as PackagePublishError", () => {
		const err = new PackagePublishError({ operation: "publish", reason: "boom" });
		expect(err._tag).toBe("PackagePublishError");
	});

	it("message composes [operation] reason", () => {
		const err = new PackagePublishError({ operation: "publish", reason: "boom" });
		expect(err.message).toBe("[publish] boom");
	});

	it("message appends the cause's stderr when present", () => {
		// The appended stderr starts on its own line so multi-line npm/git
		// output reads naturally in CI logs and check-run pages.
		const err = new PackagePublishError({
			operation: "publish",
			reason: "Command exited with code 1",
			cause: { stderr: "npm error 403 Forbidden" },
		});
		expect(err.message).toBe("[publish] Command exited with code 1:\nnpm error 403 Forbidden");
	});

	it("message omits cause when stderr is absent", () => {
		const err = new PackagePublishError({
			operation: "dryRun",
			reason: "Something went wrong",
			cause: new Error("inner"),
		});
		expect(err.message).toBe("[dryRun] Something went wrong");
	});

	it("message omits cause when stderr is empty", () => {
		const err = new PackagePublishError({
			operation: "pack",
			reason: "Pack failed",
			cause: { stderr: "   " },
		});
		expect(err.message).toBe("[pack] Pack failed");
	});

	it("shows the tail of long stderr (where errors live), not the head", () => {
		// `npm` writes warnings + notices first and `npm error` lines last;
		// truncating from the head surfaces the cause. The cap is 2000 chars.
		const head = "h".repeat(500);
		const tail = "t".repeat(2000);
		const err = new PackagePublishError({
			operation: "publish",
			reason: "failed",
			cause: { stderr: `${head}\n${tail}` },
		});

		expect(err.message).toContain(tail);
		expect(err.message).not.toContain(head);
		expect(err.message).toMatch(/\.\.\.\[\d+ chars truncated from head\]\.\.\./);
	});

	it("falls back to stdout when the cause's stderr is empty", () => {
		const err = new PackagePublishError({
			operation: "publish",
			reason: "failed",
			cause: { stderr: "", stdout: "npm error E403 Forbidden" },
		});
		expect(err.message).toContain("npm error E403 Forbidden");
	});
});
