import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ActionOutputsTest } from "../layers/ActionOutputsTest.js";
import { ReportBuilder } from "./ReportBuilder.js";
import type { SpanSummary } from "./TelemetryReport.js";

describe("ReportBuilder", () => {
	describe("create", () => {
		it("returns a Report", () => {
			const report = ReportBuilder.create("My Report");
			expect(report).toBeDefined();
			expect(typeof report.section).toBe("function");
			expect(typeof report.stat).toBe("function");
			expect(typeof report.details).toBe("function");
			expect(typeof report.timings).toBe("function");
			expect(typeof report.toMarkdown).toBe("function");
			expect(typeof report.toSummary).toBe("function");
			expect(typeof report.toComment).toBe("function");
			expect(typeof report.toCheckRun).toBe("function");
		});
	});

	describe("toMarkdown", () => {
		it("renders just the title for an empty report", () => {
			const md = ReportBuilder.create("Empty Report").toMarkdown();
			expect(md).toBe("## Empty Report");
		});

		it("renders a section with heading and content", () => {
			const md = ReportBuilder.create("Report").section("Overview", "All good.").toMarkdown();
			expect(md).toContain("## Report");
			expect(md).toContain("### Overview");
			expect(md).toContain("All good.");
		});

		it("accumulates stats into a table", () => {
			const md = ReportBuilder.create("Stats Report").stat("Duration", "1.5s").stat("Packages", 12).toMarkdown();
			expect(md).toContain("| Stat | Value |");
			expect(md).toContain("| Duration | 1.5s |");
			expect(md).toContain("| Packages | 12 |");
		});

		it("renders a collapsible details block", () => {
			const md = ReportBuilder.create("Report").details("Click to expand", "Hidden content").toMarkdown();
			expect(md).toContain("<details>");
			expect(md).toContain("<summary>Click to expand</summary>");
			expect(md).toContain("Hidden content");
			expect(md).toContain("</details>");
		});

		it("renders timings from spans", () => {
			const spans: Array<SpanSummary> = [
				{ name: "build", duration: 200, status: "ok", attributes: {} },
				{ name: "test", duration: 1500, status: "error", attributes: {} },
			];
			const md = ReportBuilder.create("CI Report").timings(spans).toMarkdown();
			expect(md).toContain("### Timing Report");
			expect(md).toContain("| build | 200ms |");
			expect(md).toContain("| test | 1.50s |");
		});

		it("chains multiple methods producing correct output order", () => {
			const md = ReportBuilder.create("Full Report")
				.stat("Files", 5)
				.section("Summary", "Looks good.")
				.details("Logs", "verbose output here")
				.toMarkdown();

			const statTableIndex = md.indexOf("| Stat | Value |");
			const sectionIndex = md.indexOf("### Summary");
			const detailsIndex = md.indexOf("<details>");

			// Stats table comes before sections
			expect(statTableIndex).toBeLessThan(sectionIndex);
			// Sections come before details
			expect(sectionIndex).toBeLessThan(detailsIndex);
		});
	});

	describe("toSummary", () => {
		it("calls ActionOutputs.summary with rendered markdown", async () => {
			const state = ActionOutputsTest.empty();
			const report = ReportBuilder.create("Test Report").stat("Count", 42);

			await Effect.runPromise(report.toSummary().pipe(Effect.provide(ActionOutputsTest.layer(state))));

			expect(state.summaries).toHaveLength(1);
			expect(state.summaries[0]).toContain("## Test Report");
			expect(state.summaries[0]).toContain("| Count | 42 |");
		});
	});

	describe("immutability", () => {
		it("original report is unchanged after calling a method", () => {
			const original = ReportBuilder.create("Original");
			const modified = original.stat("Key", "Value");

			const originalMd = original.toMarkdown();
			const modifiedMd = modified.toMarkdown();

			expect(originalMd).toBe("## Original");
			expect(modifiedMd).toContain("| Key | Value |");
			expect(originalMd).not.toContain("| Key | Value |");
		});

		it("section does not mutate original", () => {
			const original = ReportBuilder.create("Base");
			original.section("Added", "content");

			expect(original.toMarkdown()).toBe("## Base");
		});

		it("details does not mutate original", () => {
			const original = ReportBuilder.create("Base");
			original.details("Summary", "content");

			expect(original.toMarkdown()).toBe("## Base");
		});
	});
});
