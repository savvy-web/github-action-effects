import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ActionOutputsTest } from "../layers/ActionOutputsTest.js";
import { CheckRunTest } from "../layers/CheckRunTest.js";
import { PullRequestCommentTest } from "../layers/PullRequestCommentTest.js";
import { CheckRun } from "../services/CheckRun.js";
import type { SpanSummary } from "./TelemetryReport.js";
import { TelemetryReport } from "./TelemetryReport.js";

const makeSpan = (overrides: Partial<SpanSummary> & { name: string }): SpanSummary => ({
	duration: 100,
	status: "ok",
	attributes: {},
	...overrides,
});

describe("TelemetryReport", () => {
	describe("fromSpans", () => {
		it("returns empty string for empty arrays", () => {
			expect(TelemetryReport.fromSpans([])).toBe("");
			expect(TelemetryReport.fromSpans([], [])).toBe("");
		});

		it("renders a table with correct columns", () => {
			const spans = [makeSpan({ name: "build", duration: 200 })];
			const result = TelemetryReport.fromSpans(spans);

			expect(result).toContain("### Timing Report");
			expect(result).toContain("| Operation | Duration | Status |");
			expect(result).toContain("| build | 200ms | \u2705 |");
		});

		it("formats duration as ms for values under 1000", () => {
			const spans = [makeSpan({ name: "fast", duration: 42 })];
			const result = TelemetryReport.fromSpans(spans);
			expect(result).toContain("| fast | 42ms |");
		});

		it("formats duration as seconds for values >= 1000", () => {
			const spans = [makeSpan({ name: "slow", duration: 1500 })];
			const result = TelemetryReport.fromSpans(spans);
			expect(result).toContain("| slow | 1.50s |");
		});

		it("shows correct status emoji", () => {
			const spans = [makeSpan({ name: "pass-op", status: "ok" }), makeSpan({ name: "fail-op", status: "error" })];
			const result = TelemetryReport.fromSpans(spans);
			expect(result).toContain("| pass-op | 100ms | \u2705 |");
			expect(result).toContain("| fail-op | 100ms | \u274C |");
		});

		it("indents child spans under their parent", () => {
			const spans = [
				makeSpan({ name: "root", duration: 500 }),
				makeSpan({ name: "child", duration: 200, parentName: "root" }),
			];
			const result = TelemetryReport.fromSpans(spans);
			const lines = result.split("\n");

			// Root should come before child
			const rootLine = lines.findIndex((l) => l.includes("| root |"));
			const childLine = lines.findIndex((l) => l.includes("\u2514 child"));
			expect(rootLine).toBeGreaterThan(-1);
			expect(childLine).toBeGreaterThan(rootLine);
			expect(lines[childLine]).toContain("  \u2514 child");
		});

		it("renders a metrics table when metrics are provided", () => {
			const metrics = [
				{ name: "bundle-size", value: 1024, unit: "bytes" as string | undefined, timestamp: Date.now() },
				{ name: "test-count", value: 42, unit: undefined, timestamp: Date.now() },
			];
			const result = TelemetryReport.fromSpans([], metrics);

			expect(result).toContain("### Metrics");
			expect(result).toContain("| Metric | Value | Unit |");
			expect(result).toContain("| bundle-size | 1024 | bytes |");
			expect(result).toContain("| test-count | 42 |");
		});

		it("renders both timing and metrics sections when both are provided", () => {
			const spans = [makeSpan({ name: "build", duration: 300 })];
			const metrics = [{ name: "size", value: 512, unit: "KB" as string | undefined, timestamp: Date.now() }];
			const result = TelemetryReport.fromSpans(spans, metrics);

			expect(result).toContain("### Timing Report");
			expect(result).toContain("### Metrics");
		});
	});

	describe("toSummary", () => {
		it("calls ActionOutputs.summary with the report", async () => {
			const state = ActionOutputsTest.empty();
			const spans = [makeSpan({ name: "deploy", duration: 2500 })];

			await Effect.runPromise(TelemetryReport.toSummary(spans).pipe(Effect.provide(ActionOutputsTest.layer(state))));

			expect(state.summaries).toHaveLength(1);
			expect(state.summaries[0]).toContain("### Timing Report");
			expect(state.summaries[0]).toContain("deploy");
		});

		it("does not call summary when report is empty", async () => {
			const state = ActionOutputsTest.empty();

			await Effect.runPromise(TelemetryReport.toSummary([]).pipe(Effect.provide(ActionOutputsTest.layer(state))));

			expect(state.summaries).toHaveLength(0);
		});
	});

	describe("toComment", () => {
		it("calls PullRequestComment.upsert with the report", async () => {
			const state = PullRequestCommentTest.empty();
			const spans = [makeSpan({ name: "lint", duration: 800 })];

			await Effect.runPromise(
				TelemetryReport.toComment(42, "telemetry", spans).pipe(Effect.provide(PullRequestCommentTest.layer(state))),
			);

			const prComments = state.comments.get(42) ?? [];
			expect(prComments).toHaveLength(1);
			expect(prComments[0].body).toContain("### Timing Report");
			expect(prComments[0].body).toContain("lint");
		});

		it("does not create a comment when report is empty", async () => {
			const state = PullRequestCommentTest.empty();

			await Effect.runPromise(
				TelemetryReport.toComment(42, "telemetry", []).pipe(Effect.provide(PullRequestCommentTest.layer(state))),
			);

			expect(state.comments.size).toBe(0);
		});
	});

	describe("toCheckRun", () => {
		it("calls CheckRun.update with the report as text", async () => {
			const state = CheckRunTest.empty();
			// Pre-create a check run to update
			await Effect.runPromise(
				Effect.flatMap(CheckRun, (cr) => cr.create("test-check", "abc123")).pipe(
					Effect.provide(CheckRunTest.layer(state)),
				),
			);

			const spans = [makeSpan({ name: "test", duration: 350 })];

			await Effect.runPromise(TelemetryReport.toCheckRun(1, spans).pipe(Effect.provide(CheckRunTest.layer(state))));

			expect(state.runs).toHaveLength(1);
			expect(state.runs[0].outputs).toHaveLength(1);
			expect(state.runs[0].outputs[0].title).toBe("Telemetry Report");
			expect(state.runs[0].outputs[0].text).toContain("### Timing Report");
			expect(state.runs[0].outputs[0].text).toContain("test");
		});
	});
});
