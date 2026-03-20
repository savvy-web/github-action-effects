import { Cause, Data, FiberId } from "effect";
import { describe, expect, it } from "vitest";
import { Action } from "./Action.js";

describe("Action.formatCause", () => {
	it("extracts message from a Fail cause with TaggedError", () => {
		class TestError extends Data.TaggedError("TestError")<{ reason: string }> {}
		const error = new TestError({ reason: "something broke" });
		const cause = Cause.fail(error);
		const message = Action.formatCause(cause);
		expect(message).toContain("[TestError]");
		expect(message).toContain("something broke");
	});

	it("extracts message from a Die cause with standard Error", () => {
		const cause = Cause.die(new Error("unexpected boom"));
		const message = Action.formatCause(cause);
		expect(message).toContain("[Error]");
		expect(message).toContain("unexpected boom");
	});

	it("extracts message from a Die cause with non-Error value", () => {
		const cause = Cause.die({ code: 42, detail: "weird" });
		const message = Action.formatCause(cause);
		expect(message).not.toBe("");
		expect(message).toContain("42");
	});

	it("never returns an empty string", () => {
		const cause = Cause.empty;
		const message = Action.formatCause(cause);
		expect(message.length).toBeGreaterThan(0);
	});

	it("handles interrupt cause", () => {
		const cause = Cause.interrupt(FiberId.make(1, 0));
		const message = Action.formatCause(cause);
		expect(message.length).toBeGreaterThan(0);
	});

	it("produces non-empty output for Die with TaggedError", () => {
		class LayerSetupError extends Data.TaggedError("LayerSetupError")<{ readonly reason: string }> {}
		const error = new LayerSetupError({ reason: "missing dependency" });
		const cause = Cause.die(error);
		const msg = Action.formatCause(cause);
		expect(msg).not.toBe("");
		expect(msg.length).toBeGreaterThan(5);
	});
});
