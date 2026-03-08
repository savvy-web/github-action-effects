import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CapturedOutput, ChecklistItem, Status } from "./GithubMarkdown.js";

describe("Status", () => {
	it("accepts valid statuses", () => {
		expect(Schema.decodeUnknownSync(Status)("pass")).toBe("pass");
		expect(Schema.decodeUnknownSync(Status)("fail")).toBe("fail");
		expect(Schema.decodeUnknownSync(Status)("skip")).toBe("skip");
		expect(Schema.decodeUnknownSync(Status)("warn")).toBe("warn");
	});

	it("rejects invalid status", () => {
		expect(() => Schema.decodeUnknownSync(Status)("error")).toThrow();
	});
});

describe("ChecklistItem", () => {
	it("decodes a valid checklist item", () => {
		const input = { label: "Run tests", checked: true };
		const result = Schema.decodeUnknownSync(ChecklistItem)(input);
		expect(result).toEqual(input);
	});

	it("rejects non-boolean checked", () => {
		expect(() => Schema.decodeUnknownSync(ChecklistItem)({ label: "Test", checked: "yes" })).toThrow();
	});
});

describe("CapturedOutput", () => {
	it("decodes a valid captured output", () => {
		const input = { name: "version", value: "1.0.0" };
		const result = Schema.decodeUnknownSync(CapturedOutput)(input);
		expect(result).toEqual(input);
	});

	it("rejects missing value", () => {
		expect(() => Schema.decodeUnknownSync(CapturedOutput)({ name: "version" })).toThrow();
	});
});
