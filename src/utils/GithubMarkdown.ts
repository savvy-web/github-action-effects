import type { ChecklistItem, Status } from "../schemas/GithubMarkdown.js";

/**
 * Namespace for GitHub-Flavored Markdown builder functions.
 *
 * @example
 * ```ts
 * import { GithubMarkdown } from "@savvy-web/github-action-effects"
 *
 * GithubMarkdown.table(["Name", "Status"], [["build", "pass"]])
 * GithubMarkdown.bold("hello")
 * ```
 *
 * @public
 */
export const GithubMarkdown = {
	/**
	 * Build a GFM table from headers and rows.
	 */
	table: (headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string => {
		const headerRow = `| ${headers.join(" | ")} |`;
		const separator = `| ${headers.map(() => "---").join(" | ")} |`;
		const dataRows = rows.map((row) => `| ${row.join(" | ")} |`);
		return [headerRow, separator, ...dataRows].join("\n");
	},

	/**
	 * Build a markdown heading.
	 *
	 * @param level - Heading level 1-6, defaults to 2.
	 */
	heading: (text: string, level: 1 | 2 | 3 | 4 | 5 | 6 = 2): string => `${"#".repeat(level)} ${text}`,

	/**
	 * Build a collapsible `<details>` block.
	 */
	details: (summary: string, content: string): string =>
		`<details>\n<summary>${summary}</summary>\n\n${content}\n\n</details>`,

	/**
	 * Horizontal rule.
	 */
	rule: (): string => "---",

	/**
	 * Map a {@link Status} to its emoji indicator.
	 */
	statusIcon: (status: Status): string => {
		switch (status) {
			case "pass":
				return "\u2705";
			case "fail":
				return "\u274C";
			case "skip":
				return "\uD83D\uDDC3\uFE0F";
			case "warn":
				return "\u26A0\uFE0F";
		}
	},

	/**
	 * Build a markdown link.
	 */
	link: (text: string, url: string): string => `[${text}](${url})`,

	/**
	 * Build a bulleted list.
	 */
	list: (items: ReadonlyArray<string>): string => items.map((item) => `- ${item}`).join("\n"),

	/**
	 * Build a checkbox checklist.
	 */
	checklist: (items: ReadonlyArray<ChecklistItem>): string =>
		items.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`).join("\n"),

	/**
	 * Bold text.
	 */
	bold: (text: string): string => `**${text}**`,

	/**
	 * Inline code.
	 */
	code: (text: string): string => `\`${text}\``,

	/**
	 * Fenced code block.
	 */
	codeBlock: (content: string, language = ""): string => `\`\`\`${language}\n${content}\n\`\`\``,
} as const;
