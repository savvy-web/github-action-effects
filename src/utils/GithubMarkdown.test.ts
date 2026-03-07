import { describe, expect, it } from "vitest";
import { GithubMarkdown } from "./GithubMarkdown.js";

describe("GithubMarkdown", () => {
	describe("table", () => {
		it("builds a GFM table from headers and rows", () => {
			const result = GithubMarkdown.table(
				["Name", "Status"],
				[
					["build", "pass"],
					["test", "fail"],
				],
			);
			expect(result).toBe(["| Name | Status |", "| --- | --- |", "| build | pass |", "| test | fail |"].join("\n"));
		});

		it("handles empty rows", () => {
			const result = GithubMarkdown.table(["A", "B"], []);
			expect(result).toBe("| A | B |\n| --- | --- |");
		});
	});

	describe("heading", () => {
		it("defaults to h2", () => {
			expect(GithubMarkdown.heading("Title")).toBe("## Title");
		});

		it("supports all heading levels", () => {
			expect(GithubMarkdown.heading("Title", 1)).toBe("# Title");
			expect(GithubMarkdown.heading("Title", 3)).toBe("### Title");
			expect(GithubMarkdown.heading("Title", 6)).toBe("###### Title");
		});
	});

	describe("details", () => {
		it("builds a collapsible details block", () => {
			const result = GithubMarkdown.details("Summary", "Content here");
			expect(result).toBe("<details>\n<summary>Summary</summary>\n\nContent here\n\n</details>");
		});
	});

	describe("rule", () => {
		it("returns a horizontal rule", () => {
			expect(GithubMarkdown.rule()).toBe("---");
		});
	});

	describe("statusIcon", () => {
		it("maps status to emoji", () => {
			expect(GithubMarkdown.statusIcon("pass")).toBe("\u2705");
			expect(GithubMarkdown.statusIcon("fail")).toBe("\u274C");
			expect(GithubMarkdown.statusIcon("skip")).toBe("\uD83D\uDDC3\uFE0F");
			expect(GithubMarkdown.statusIcon("warn")).toBe("\u26A0\uFE0F");
		});
	});

	describe("link", () => {
		it("builds a markdown link", () => {
			expect(GithubMarkdown.link("Click", "https://example.com")).toBe("[Click](https://example.com)");
		});
	});

	describe("list", () => {
		it("builds a bulleted list", () => {
			expect(GithubMarkdown.list(["one", "two", "three"])).toBe("- one\n- two\n- three");
		});
	});

	describe("checklist", () => {
		it("builds a checkbox checklist", () => {
			const result = GithubMarkdown.checklist([
				{ label: "done", checked: true },
				{ label: "todo", checked: false },
			]);
			expect(result).toBe("- [x] done\n- [ ] todo");
		});
	});

	describe("bold", () => {
		it("wraps text in bold markers", () => {
			expect(GithubMarkdown.bold("text")).toBe("**text**");
		});
	});

	describe("code", () => {
		it("wraps text in inline code", () => {
			expect(GithubMarkdown.code("foo")).toBe("`foo`");
		});
	});

	describe("codeBlock", () => {
		it("builds a fenced code block", () => {
			expect(GithubMarkdown.codeBlock("const x = 1", "ts")).toBe("```ts\nconst x = 1\n```");
		});

		it("works without a language", () => {
			expect(GithubMarkdown.codeBlock("hello")).toBe("```\nhello\n```");
		});
	});
});
