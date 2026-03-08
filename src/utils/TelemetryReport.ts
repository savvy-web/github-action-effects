import { Effect } from "effect";
import type { ActionOutputError } from "../errors/ActionOutputError.js";
import type { CheckRunError } from "../errors/CheckRunError.js";
import type { PullRequestCommentError } from "../errors/PullRequestCommentError.js";
import type { MetricData } from "../schemas/Telemetry.js";
import { ActionOutputs } from "../services/ActionOutputs.js";
import { CheckRun } from "../services/CheckRun.js";
import { PullRequestComment } from "../services/PullRequestComment.js";
import { GithubMarkdown } from "./GithubMarkdown.js";

/**
 * Public-facing span summary for telemetry reports.
 *
 * @public
 */
export interface SpanSummary {
	readonly name: string;
	readonly duration: number;
	readonly status: "ok" | "error";
	readonly parentName?: string;
	readonly attributes: Record<string, string>;
}

/**
 * Format a duration in milliseconds as a human-readable string.
 */
const formatDuration = (ms: number): string => {
	if (ms >= 1000) {
		return `${(ms / 1000).toFixed(2)}s`;
	}
	return `${Math.round(ms)}ms`;
};

/**
 * Map span status to emoji.
 */
const statusEmoji = (status: "ok" | "error"): string => (status === "ok" ? "\u2705" : "\u274C");

/**
 * Namespace for rendering telemetry span data as GitHub-Flavored Markdown
 * and sending to various GitHub Action outputs.
 *
 * @example
 * ```ts
 * import { TelemetryReport } from "@savvy-web/github-action-effects"
 *
 * const md = TelemetryReport.fromSpans(spans, metrics)
 * ```
 *
 * @public
 */
export const TelemetryReport = {
	/**
	 * Render spans and optional metrics as a GFM markdown string.
	 *
	 * Root spans (no parentName) appear first, children are indented with `  \u2514 `.
	 * Durations are formatted as `Xms` or `X.XXs` for values \>= 1000ms.
	 *
	 * Note: Only 1 level of nesting is supported. Children whose parentName
	 * does not match a root span are rendered as orphans at the end of the table.
	 */
	fromSpans: (spans: ReadonlyArray<SpanSummary>, metrics?: ReadonlyArray<MetricData>): string => {
		const hasSpans = spans.length > 0;
		const hasMetrics = metrics !== undefined && metrics.length > 0;

		if (!hasSpans && !hasMetrics) {
			return "";
		}

		const sections: Array<string> = [];

		if (hasSpans) {
			// Separate root and child spans
			const roots = spans.filter((s) => s.parentName === undefined);
			const children = spans.filter((s) => s.parentName !== undefined);

			// Build rows: roots first, then children grouped under their parent
			const rows: Array<ReadonlyArray<string>> = [];
			for (const root of roots) {
				rows.push([root.name, formatDuration(root.duration), statusEmoji(root.status)]);
				// Add children of this root
				for (const child of children) {
					if (child.parentName === root.name) {
						rows.push([`  \u2514 ${child.name}`, formatDuration(child.duration), statusEmoji(child.status)]);
					}
				}
			}

			// Add any children whose parent is not a root (orphaned children)
			const rootNames = new Set(roots.map((r) => r.name));
			for (const child of children) {
				if (child.parentName !== undefined && !rootNames.has(child.parentName)) {
					rows.push([`  \u2514 ${child.name}`, formatDuration(child.duration), statusEmoji(child.status)]);
				}
			}

			sections.push(GithubMarkdown.heading("Timing Report", 3));
			sections.push(GithubMarkdown.table(["Operation", "Duration", "Status"], rows));
		}

		if (hasMetrics && metrics !== undefined) {
			sections.push(GithubMarkdown.heading("Metrics", 3));
			const metricRows = metrics.map((m) => [m.name, String(m.value), m.unit ?? ""]);
			sections.push(GithubMarkdown.table(["Metric", "Value", "Unit"], metricRows));
		}

		return sections.join("\n\n");
	},

	/**
	 * Write telemetry report to step summary via ActionOutputs.
	 */
	toSummary: (
		spans: ReadonlyArray<SpanSummary>,
		metrics?: ReadonlyArray<MetricData>,
	): Effect.Effect<void, ActionOutputError, ActionOutputs> =>
		Effect.flatMap(ActionOutputs, (outputs) => {
			const report = TelemetryReport.fromSpans(spans, metrics);
			if (report === "") {
				return Effect.void;
			}
			return outputs.summary(report);
		}),

	/**
	 * Upsert telemetry report as a PR comment.
	 */
	toComment: (
		prNumber: number,
		markerKey: string,
		spans: ReadonlyArray<SpanSummary>,
		metrics?: ReadonlyArray<MetricData>,
	): Effect.Effect<void, PullRequestCommentError, PullRequestComment> =>
		Effect.flatMap(PullRequestComment, (prComment) => {
			const report = TelemetryReport.fromSpans(spans, metrics);
			if (report === "") {
				return Effect.void;
			}
			return Effect.asVoid(prComment.upsert(prNumber, markerKey, report));
		}),

	/**
	 * Set telemetry report as check run output.
	 */
	toCheckRun: (
		checkRunId: number,
		spans: ReadonlyArray<SpanSummary>,
		metrics?: ReadonlyArray<MetricData>,
	): Effect.Effect<void, CheckRunError, CheckRun> =>
		Effect.flatMap(CheckRun, (checkRun) => {
			const report = TelemetryReport.fromSpans(spans, metrics);
			if (report === "") {
				return Effect.void;
			}
			return checkRun.update(checkRunId, {
				title: "Telemetry Report",
				summary: "Timing and metrics data",
				text: report,
			});
		}),
} as const;
