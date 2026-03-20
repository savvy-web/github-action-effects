import { describe, expect, it, vi } from "vitest";
import { escapeData, escapeProperty, format, issue } from "./WorkflowCommand.js";

describe("format", () => {
	it("formats a command with no properties and a message", () => {
		expect(format("debug", {}, "hello")).toBe("::debug::hello");
	});

	it("formats a command with properties and a message", () => {
		expect(format("error", { file: "foo.ts", line: "42" }, "msg")).toBe("::error file=foo.ts,line=42::msg");
	});

	it("formats a command with no properties and a simple message", () => {
		expect(format("add-mask", {}, "secret")).toBe("::add-mask::secret");
	});

	it("formats a group command", () => {
		expect(format("group", {}, "Section")).toBe("::group::Section");
	});

	it("formats an endgroup command with empty message", () => {
		expect(format("endgroup", {}, "")).toBe("::endgroup::");
	});
});

describe("escapeData", () => {
	it("escapes % to %25", () => {
		expect(escapeData("100%")).toBe("100%25");
	});

	it("escapes \\r to %0D", () => {
		expect(escapeData("foo\rbar")).toBe("foo%0Dbar");
	});

	it("escapes \\n to %0A", () => {
		expect(escapeData("foo\nbar")).toBe("foo%0Abar");
	});

	it("escapes multiple special chars", () => {
		expect(escapeData("50%\r\nend")).toBe("50%25%0D%0Aend");
	});
});

describe("escapeProperty", () => {
	it("escapes : to %3A", () => {
		expect(escapeProperty("foo:bar")).toBe("foo%3Abar");
	});

	it("escapes , to %2C", () => {
		expect(escapeProperty("foo,bar")).toBe("foo%2Cbar");
	});

	it("also escapes % \\r \\n like escapeData", () => {
		expect(escapeProperty("a%b\rc\nd")).toBe("a%25b%0Dc%0Ad");
	});
});

describe("issue", () => {
	it("writes the formatted command to process.stdout", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		issue("debug", {}, "hello");
		expect(writeSpy).toHaveBeenCalledWith("::debug::hello" + "\n");
		writeSpy.mockRestore();
	});
});
