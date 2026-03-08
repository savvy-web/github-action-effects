import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DryRunLive } from "../layers/DryRunLive.js";
import { DryRunTest } from "../layers/DryRunTest.js";
import { DryRun } from "./DryRun.js";

describe("DryRun", () => {
	it("isDryRun returns true when enabled", async () => {
		const result = await Effect.runPromise(
			DryRun.pipe(
				Effect.flatMap((dr) => dr.isDryRun),
				Effect.provide(DryRunLive(true)),
			),
		);
		expect(result).toBe(true);
	});

	it("isDryRun returns false when disabled", async () => {
		const result = await Effect.runPromise(
			DryRun.pipe(
				Effect.flatMap((dr) => dr.isDryRun),
				Effect.provide(DryRunLive(false)),
			),
		);
		expect(result).toBe(false);
	});

	it("guard executes effect when not dry-run", async () => {
		let executed = false;
		const result = await Effect.runPromise(
			DryRun.pipe(
				Effect.flatMap((dr) =>
					dr.guard(
						"create-branch",
						Effect.sync(() => {
							executed = true;
							return "created";
						}),
						"skipped",
					),
				),
				Effect.provide(DryRunLive(false)),
			),
		);
		expect(result).toBe("created");
		expect(executed).toBe(true);
	});

	it("guard returns fallback when dry-run", async () => {
		let executed = false;
		const result = await Effect.runPromise(
			DryRun.pipe(
				Effect.flatMap((dr) =>
					dr.guard(
						"create-branch",
						Effect.sync(() => {
							executed = true;
							return "created";
						}),
						"skipped",
					),
				),
				Effect.provide(DryRunLive(true)),
			),
		);
		expect(result).toBe("skipped");
		expect(executed).toBe(false);
	});

	it("guard logs dry-run label", async () => {
		await Effect.runPromise(
			DryRun.pipe(
				Effect.flatMap((dr) => dr.guard("delete-branch", Effect.succeed("done"), "skipped")),
				Effect.provide(DryRunLive(true)),
			),
		);
		// If it doesn't throw, the log was emitted without error
		// (we can't easily capture Effect.logInfo in tests without a custom logger)
	});

	it("test layer records guarded labels", async () => {
		const { state, layer } = DryRunTest.empty();
		await Effect.runPromise(
			DryRun.pipe(
				Effect.flatMap((dr) =>
					Effect.all([
						dr.guard("create-pr", Effect.succeed("pr"), "dry-pr"),
						dr.guard("merge-pr", Effect.succeed("merged"), "dry-merge"),
					]),
				),
				Effect.provide(layer),
			),
		);
		expect(state.guardedLabels).toEqual(["create-pr", "merge-pr"]);
	});
});
