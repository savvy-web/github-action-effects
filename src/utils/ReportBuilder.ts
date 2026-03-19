import { Effect } from "effect";
import type { ActionOutputError } from "../errors/ActionOutputError.js";
import type { CheckRunError } from "../errors/CheckRunError.js";
import type { PullRequestCommentError } from "../errors/PullRequestCommentError.js";
import { ActionOutputs } from "../services/ActionOutputs.js";
import { CheckRun } from "../services/CheckRun.js";
import { PullRequestComment } from "../services/PullRequestComment.js";
import { GithubMarkdown } from "./GithubMarkdown.js";

/**
 * A report entry — one of the content blocks that can be added.
 */
type ReportEntry =
	| { readonly _tag: "section"; readonly title: string; readonly content: string }
	| { readonly _tag: "details"; readonly summary: string; readonly content: string };

/**
 * A stat row for the summary table.
 */
interface StatRow {
	readonly label: string;
	readonly value: string;
}

/**
 * An immutable report that accumulates content and renders to markdown.
 *
 * @public
 */
export interface Report {
	/** Add a titled section with markdown content. */
	readonly section: (title: string, content: string) => Report;
	/** Add a key-value summary row. */
	readonly stat: (label: string, value: string | number) => Report;
	/** Add a collapsible details block. */
	readonly details: (summary: string, content: string) => Report;
	/** Render to markdown string. */
	readonly toMarkdown: () => string;
	/** Write to step summary via ActionOutputs. */
	readonly toSummary: () => Effect.Effect<void, ActionOutputError, ActionOutputs>;
	/** Upsert as PR comment via PullRequestComment. */
	readonly toComment: (
		prNumber: number,
		markerKey: string,
	) => Effect.Effect<void, PullRequestCommentError, PullRequestComment>;
	/** Set as check run output via CheckRun. */
	readonly toCheckRun: (checkRunId: number) => Effect.Effect<void, CheckRunError, CheckRun>;
}

/**
 * Internal factory for creating Report instances.
 */
const makeReport = (title: string, stats: ReadonlyArray<StatRow>, entries: ReadonlyArray<ReportEntry>): Report => ({
	section: (sectionTitle: string, content: string): Report =>
		makeReport(title, stats, [...entries, { _tag: "section", title: sectionTitle, content }]),

	stat: (label: string, value: string | number): Report =>
		makeReport(title, [...stats, { label, value: String(value) }], entries),

	details: (summary: string, content: string): Report =>
		makeReport(title, stats, [...entries, { _tag: "details", summary, content }]),

	toMarkdown: (): string => {
		const parts: Array<string> = [];

		parts.push(GithubMarkdown.heading(title, 2));

		if (stats.length > 0) {
			parts.push(
				GithubMarkdown.table(
					["Stat", "Value"],
					stats.map((s) => [s.label, s.value]),
				),
			);
		}

		for (const entry of entries) {
			switch (entry._tag) {
				case "section":
					parts.push(`${GithubMarkdown.heading(entry.title, 3)}\n\n${entry.content}`);
					break;
				case "details":
					parts.push(GithubMarkdown.details(entry.summary, entry.content));
					break;
			}
		}

		return parts.join("\n\n");
	},

	toSummary: (): Effect.Effect<void, ActionOutputError, ActionOutputs> =>
		Effect.flatMap(ActionOutputs, (outputs) => outputs.summary(makeReport(title, stats, entries).toMarkdown())),

	toComment: (prNumber: number, markerKey: string): Effect.Effect<void, PullRequestCommentError, PullRequestComment> =>
		Effect.flatMap(PullRequestComment, (prComment) =>
			Effect.asVoid(prComment.upsert(prNumber, markerKey, makeReport(title, stats, entries).toMarkdown())),
		),

	toCheckRun: (checkRunId: number): Effect.Effect<void, CheckRunError, CheckRun> =>
		Effect.flatMap(CheckRun, (checkRun) =>
			checkRun.update(checkRunId, {
				title,
				summary: title,
				text: makeReport(title, stats, entries).toMarkdown(),
			}),
		),
});

/**
 * Namespace for composing markdown reports with a fluent builder API.
 *
 * @example
 * ```ts
 * import { ReportBuilder } from "@savvy-web/github-action-effects"
 *
 * const report = ReportBuilder.create("Build Report")
 *   .stat("Duration", "1.5s")
 *   .stat("Packages", 12)
 *   .section("Details", "Everything passed.")
 *   .toMarkdown()
 * ```
 *
 * @public
 */
export const ReportBuilder = {
	/** Create a new report with a title. */
	create: (title: string): Report => makeReport(title, [], []),
} as const;
