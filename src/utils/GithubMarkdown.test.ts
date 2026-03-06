import { describe, expect, it } from "vitest";
import {
	bold,
	checklist,
	code,
	codeBlock,
	details,
	heading,
	link,
	list,
	rule,
	statusIcon,
	table,
} from "./GithubMarkdown.js";

describe("GithubMarkdown", () => {
	describe("table", () => {
		it("builds a GFM table from headers and rows", () => {
			const result = table(
				["Name", "Status"],
				[
					["build", "pass"],
					["test", "fail"],
				],
			);
			expect(result).toBe(["| Name | Status |", "| --- | --- |", "| build | pass |", "| test | fail |"].join("\n"));
		});

		it("handles empty rows", () => {
			const result = table(["A", "B"], []);
			expect(result).toBe("| A | B |\n| --- | --- |");
		});
	});

	describe("heading", () => {
		it("defaults to h2", () => {
			expect(heading("Title")).toBe("## Title");
		});

		it("supports all heading levels", () => {
			expect(heading("Title", 1)).toBe("# Title");
			expect(heading("Title", 3)).toBe("### Title");
			expect(heading("Title", 6)).toBe("###### Title");
		});
	});

	describe("details", () => {
		it("builds a collapsible details block", () => {
			const result = details("Summary", "Content here");
			expect(result).toBe("<details>\n<summary>Summary</summary>\n\nContent here\n\n</details>");
		});
	});

	describe("rule", () => {
		it("returns a horizontal rule", () => {
			expect(rule()).toBe("---");
		});
	});

	describe("statusIcon", () => {
		it("maps status to emoji", () => {
			expect(statusIcon("pass")).toBe("\u2705");
			expect(statusIcon("fail")).toBe("\u274C");
			expect(statusIcon("skip")).toBe("\uD83D\uDDC3\uFE0F");
			expect(statusIcon("warn")).toBe("\u26A0\uFE0F");
		});
	});

	describe("link", () => {
		it("builds a markdown link", () => {
			expect(link("Click", "https://example.com")).toBe("[Click](https://example.com)");
		});
	});

	describe("list", () => {
		it("builds a bulleted list", () => {
			expect(list(["one", "two", "three"])).toBe("- one\n- two\n- three");
		});
	});

	describe("checklist", () => {
		it("builds a checkbox checklist", () => {
			const result = checklist([
				{ label: "done", checked: true },
				{ label: "todo", checked: false },
			]);
			expect(result).toBe("- [x] done\n- [ ] todo");
		});
	});

	describe("bold", () => {
		it("wraps text in bold markers", () => {
			expect(bold("text")).toBe("**text**");
		});
	});

	describe("code", () => {
		it("wraps text in inline code", () => {
			expect(code("foo")).toBe("`foo`");
		});
	});

	describe("codeBlock", () => {
		it("builds a fenced code block", () => {
			expect(codeBlock("const x = 1", "ts")).toBe("```ts\nconst x = 1\n```");
		});

		it("works without a language", () => {
			expect(codeBlock("hello")).toBe("```\nhello\n```");
		});
	});
});
