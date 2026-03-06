import type { ChecklistItem, Status } from "../schemas/GithubMarkdown.js";

/**
 * Build a GFM table from headers and rows.
 *
 * @example
 * ```ts
 * table(["Name", "Status"], [["build", "pass"], ["test", "fail"]])
 * ```
 */
export const table = (headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string => {
	const headerRow = `| ${headers.join(" | ")} |`;
	const separator = `| ${headers.map(() => "---").join(" | ")} |`;
	const dataRows = rows.map((row) => `| ${row.join(" | ")} |`);
	return [headerRow, separator, ...dataRows].join("\n");
};

/**
 * Build a markdown heading.
 *
 * @param level - Heading level 1-6, defaults to 2.
 */
export const heading = (text: string, level: 1 | 2 | 3 | 4 | 5 | 6 = 2): string => `${"#".repeat(level)} ${text}`;

/**
 * Build a collapsible `<details>` block.
 */
export const details = (summary: string, content: string): string =>
	`<details>\n<summary>${summary}</summary>\n\n${content}\n\n</details>`;

/**
 * Horizontal rule.
 */
export const rule = (): string => "---";

/**
 * Map a {@link Status} to its emoji indicator.
 */
export const statusIcon = (status: Status): string => {
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
};

/**
 * Build a markdown link.
 */
export const link = (text: string, url: string): string => `[${text}](${url})`;

/**
 * Build a bulleted list.
 */
export const list = (items: ReadonlyArray<string>): string => items.map((item) => `- ${item}`).join("\n");

/**
 * Build a checkbox checklist.
 */
export const checklist = (items: ReadonlyArray<ChecklistItem>): string =>
	items.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`).join("\n");

/**
 * Bold text.
 */
export const bold = (text: string): string => `**${text}**`;

/**
 * Inline code.
 */
export const code = (text: string): string => `\`${text}\``;

/**
 * Fenced code block.
 */
export const codeBlock = (content: string, language = ""): string => `\`\`\`${language}\n${content}\n\`\`\``;
