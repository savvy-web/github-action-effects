import { describe, expect, it, vi } from "vitest";
import {
	annotationProperties,
	escapeData,
	escapeProperty,
	format,
	issue,
	notice,
	resumeCommands,
	setCommandEcho,
	stopCommands,
} from "./WorkflowCommand.js";

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

describe("annotationProperties", () => {
	it("drops an empty object to {}", () => {
		expect(annotationProperties({})).toEqual({});
	});

	it("maps startLine→line and startColumn→col", () => {
		expect(annotationProperties({ startLine: 3, startColumn: 5 })).toEqual({ line: "3", col: "5" });
	});

	it("maps endLine/endColumn/title/file", () => {
		expect(
			annotationProperties({
				title: "T",
				file: "a.ts",
				startLine: 1,
				endLine: 2,
				startColumn: 3,
				endColumn: 4,
			}),
		).toEqual({ title: "T", file: "a.ts", line: "1", endLine: "2", col: "3", endColumn: "4" });
	});
});

describe("notice", () => {
	it("issues ::notice:: with a message", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		notice({}, "hi");
		expect(writeSpy).toHaveBeenCalledWith("::notice::hi\n");
		writeSpy.mockRestore();
	});

	it("maps startLine→line and startColumn→col", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		notice({ file: "a.ts", startLine: 3, startColumn: 5 }, "x");
		expect(writeSpy).toHaveBeenCalledWith("::notice file=a.ts,line=3,col=5::x\n");
		writeSpy.mockRestore();
	});

	it("includes endLine/endColumn/title", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		notice({ title: "T", endLine: 9, endColumn: 11 }, "x");
		const written = String(writeSpy.mock.calls[0]?.[0]);
		expect(written).toContain("title=T");
		expect(written).toContain("endLine=9");
		expect(written).toContain("endColumn=11");
		writeSpy.mockRestore();
	});
});

describe("stopCommands / resumeCommands / setCommandEcho", () => {
	it("stopCommands emits ::stop-commands::{token}", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		stopCommands("XYZ");
		expect(writeSpy).toHaveBeenCalledWith("::stop-commands::XYZ\n");
		writeSpy.mockRestore();
	});

	it("resumeCommands emits ::{token}::", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		resumeCommands("XYZ");
		expect(writeSpy).toHaveBeenCalledWith("::XYZ::\n");
		writeSpy.mockRestore();
	});

	it("setCommandEcho(true) emits ::echo::on", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		setCommandEcho(true);
		expect(writeSpy).toHaveBeenCalledWith("::echo::on\n");
		writeSpy.mockRestore();
	});

	it("setCommandEcho(false) emits ::echo::off", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		setCommandEcho(false);
		expect(writeSpy).toHaveBeenCalledWith("::echo::off\n");
		writeSpy.mockRestore();
	});
});
