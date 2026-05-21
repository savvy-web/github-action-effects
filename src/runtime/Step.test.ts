import { Effect, Exit, Layer, LogLevel, Logger } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionsLogger } from "./ActionsLogger.js";
import * as Step from "./Step.js";

/**
 * Test layer that installs the library's standard `ActionsLogger` so
 * that pass-through logs (warnings outside or inside Step, debug
 * outside Step) follow the live runtime's behaviour. Minimum log
 * level is `All` so debug lines are observed.
 */
const baseLoggerLayer = Layer.merge(
	Logger.replace(Logger.defaultLogger, ActionsLogger),
	Logger.minimumLogLevel(LogLevel.All),
);

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
	Effect.runPromise(Effect.provide(effect, baseLoggerLayer) as Effect.Effect<A, E, never>);

const runExit = <A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> =>
	Effect.runPromiseExit(Effect.provide(effect, baseLoggerLayer) as Effect.Effect<A, E, never>);

describe("Step", () => {
	let writeSpy: ReturnType<typeof vi.spyOn>;
	let captured: string[];

	beforeEach(() => {
		captured = [];
		writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			captured.push(String(chunk));
			return true;
		});
	});

	afterEach(() => {
		writeSpy.mockRestore();
	});

	const output = (): string => captured.join("");

	// -----------------------------------------------------------------
	// withStep — happy path
	// -----------------------------------------------------------------

	describe("withStep — happy path", () => {
		it("emits exactly one info line (the success line), debug not printed", async () => {
			await run(
				Step.withStep(
					"pack",
					Effect.gen(function* () {
						yield* Effect.logDebug("verbose pack detail A");
						yield* Effect.logDebug("verbose pack detail B");
						yield* Step.success("24.9 kB · 11 files");
						return 42;
					}),
				),
			);

			const out = output();
			// The library now prepends `✅ <name>: ` automatically — the
			// caller passes only the outcome.
			expect(out).toContain("✅ pack: 24.9 kB · 11 files");
			expect(out).not.toContain("verbose pack detail A");
			expect(out).not.toContain("verbose pack detail B");
		});

		it("withStep returns the wrapped effect's result unchanged", async () => {
			const result = await run(
				Step.withStep("compute", Effect.succeed(7).pipe(Effect.tap(() => Step.success("done")))),
			);
			expect(result).toBe(7);
		});
	});

	// -----------------------------------------------------------------
	// withStep — failure path
	// -----------------------------------------------------------------

	describe("withStep — failure path", () => {
		it("emits the failure header, spills the buffer, propagates the original error", async () => {
			const exit = await runExit(
				Step.withStep(
					"publish",
					Effect.gen(function* () {
						yield* Effect.logDebug("probe https://npm.pkg.github.com/: starting");
						yield* Effect.logDebug("probe https://npm.pkg.github.com/: HTTP 200");
						return yield* Effect.fail(new Error("integrity mismatch — local sha512-ABC ≠ remote sha512-XYZ"));
					}),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			const out = output();
			// Failure header carries the rendered error message after
			// the step name.
			expect(out).toContain("❌ publish: integrity mismatch — local sha512-ABC ≠ remote sha512-XYZ");
			expect(out).toContain("│ [DEBUG] probe https://npm.pkg.github.com/: starting");
			expect(out).toContain("│ [DEBUG] probe https://npm.pkg.github.com/: HTTP 200");
			expect(out).toContain("└ Error: integrity mismatch — local sha512-ABC ≠ remote sha512-XYZ");
		});
	});

	// -----------------------------------------------------------------
	// withStep — fallback hierarchy
	// -----------------------------------------------------------------

	describe("withStep — success fallback", () => {
		it("uses options.defaultSummary when Step.success was never called", async () => {
			await run(
				Step.withStep("probe", Effect.succeed({ count: 3 }), { defaultSummary: (r) => `probed ${r.count} targets` }),
			);
			// Library prepends `✅ <name>: `.
			expect(output()).toContain("✅ probe: probed 3 targets");
		});

		it("falls back to '✅ <name>' when neither success nor defaultSummary is set", async () => {
			await run(Step.withStep("bare", Effect.succeed(null)));
			const out = output();
			expect(out).toContain("✅ bare");
			// The bare fallback has no trailing colon (no outcome to show).
			expect(out).not.toContain("✅ bare:");
		});

		it("Step.success takes precedence over defaultSummary", async () => {
			await run(
				Step.withStep(
					"override",
					Effect.gen(function* () {
						yield* Step.success("explicit success line");
						return 1;
					}),
					{ defaultSummary: () => "default summary" },
				),
			);
			expect(output()).toContain("✅ override: explicit success line");
			expect(output()).not.toContain("default summary");
		});
	});

	// -----------------------------------------------------------------
	// withStep — nested
	// -----------------------------------------------------------------

	describe("withStep — nested", () => {
		it("indents nested success lines under the parent", async () => {
			await run(
				Step.withStep(
					"parent",
					Effect.gen(function* () {
						yield* Step.withStep(
							"child-a",
							Effect.gen(function* () {
								yield* Step.success("done");
								return 1;
							}),
						);
						yield* Step.withStep(
							"child-b",
							Effect.gen(function* () {
								yield* Step.success("done");
								return 2;
							}),
						);
						yield* Step.success("done");
						return null;
					}),
				),
			);

			const out = output();
			// Children indent by two spaces under the parent (depth 1).
			expect(out).toContain("  ✅ child-a: done");
			expect(out).toContain("  ✅ child-b: done");
			// Parent is depth 0 — no leading indent.
			expect(out).toMatch(/(^|\n)✅ parent: done/);
		});

		it("child failure prints its spill at the child's depth, then propagates to parent", async () => {
			const exit = await runExit(
				Step.withStep(
					"parent",
					Effect.gen(function* () {
						yield* Step.withStep(
							"child",
							Effect.gen(function* () {
								yield* Effect.logDebug("child detail 1");
								yield* Effect.logDebug("child detail 2");
								return yield* Effect.fail(new Error("child failed"));
							}),
						);
						// Unreachable — child propagates.
						yield* Step.success("✅ parent done");
						return null;
					}),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			const out = output();
			// Child failure header is indented one level under the parent,
			// and the error message is appended after the step name.
			expect(out).toContain("  ❌ child: child failed");
			// Child buffer lines are at the child's depth + 3-space prefix.
			expect(out).toContain("     │ [DEBUG] child detail 1");
			expect(out).toContain("     │ [DEBUG] child detail 2");
			expect(out).toContain("     └ Error: child failed");
			// Parent emits its OWN failure block since the child's
			// failure propagated out of the parent's body. The parent's
			// own buffer is empty (it logged nothing of its own).
			expect(out).toContain("❌ parent: child failed");
			expect(out).toContain("└ Error: child failed");
		});
	});

	// -----------------------------------------------------------------
	// Step.collapse
	// -----------------------------------------------------------------

	describe("Step.collapse", () => {
		it("all-success → emits ONE info line (the reducer's output)", async () => {
			const results = await run(
				Step.collapse(
					[
						{ name: "probe a", effect: Effect.succeed("present") },
						{ name: "probe b", effect: Effect.succeed("present") },
					],
					(rs) => `✅ Probe ${rs.length} registries: ${rs.map((r) => `${r.name}=${r.result}`).join(", ")}`,
				),
			);

			expect(results).toEqual(["present", "present"]);
			const out = output();
			expect(out).toContain("✅ Probe 2 registries: probe a=present, probe b=present");
			// Individual lines should NOT appear.
			expect(out).not.toContain("✅ probe a");
			expect(out).not.toContain("✅ probe b");
		});

		it("mixed outcomes → collapse abandoned; each child emits independently; failure propagates", async () => {
			const exit = await runExit(
				Step.collapse(
					[
						{ name: "probe a", effect: Effect.succeed("present") },
						{
							name: "probe b",
							effect: Effect.gen(function* () {
								yield* Effect.logDebug("probe b detail");
								return yield* Effect.fail(new Error("probe b failed"));
							}),
						},
					],
					() => "✅ all probes happy",
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			const out = output();
			// Collapsed line must NOT appear.
			expect(out).not.toContain("✅ all probes happy");
			// Each child's own line shows up.
			expect(out).toContain("✅ probe a");
			expect(out).toContain("❌ probe b");
			expect(out).toContain("│ [DEBUG] probe b detail");
			expect(out).toContain("└ Error: probe b failed");
		});

		it("reducer-returns-null → collapse abandoned even on all-success", async () => {
			await run(
				Step.collapse(
					[
						{ name: "probe a", effect: Effect.succeed("present") },
						{ name: "probe b", effect: Effect.succeed("not-published") },
					],
					(rs) => {
						// Divergent results — opt out of collapse.
						const distinct = new Set(rs.map((r) => r.result));
						return distinct.size === 1 ? `✅ all ${rs.length}: ${[...distinct][0]}` : null;
					},
				),
			);

			const out = output();
			// No collapsed line.
			expect(out).not.toContain("✅ all");
			// Each child emits its own.
			expect(out).toContain("✅ probe a");
			expect(out).toContain("✅ probe b");
		});
	});

	// -----------------------------------------------------------------
	// Pass-through behaviour
	// -----------------------------------------------------------------

	describe("pass-through", () => {
		it("Effect.logWarning inside withStep prints live, NOT buffered", async () => {
			await run(
				Step.withStep(
					"work",
					Effect.gen(function* () {
						yield* Effect.logWarning("careful now");
						yield* Step.success("done");
						return null;
					}),
				),
			);

			const out = output();
			// Warning emerges as a `::warning::` workflow command.
			expect(out).toContain("::warning::careful now");
			// And it appears in the output (live), not at the end.
			const warningIndex = out.indexOf("::warning::careful now");
			const successIndex = out.indexOf("✅ work: done");
			expect(warningIndex).toBeGreaterThanOrEqual(0);
			expect(successIndex).toBeGreaterThanOrEqual(0);
			expect(warningIndex).toBeLessThan(successIndex);
		});

		it("Effect.logInfo OUTSIDE withStep prints live", async () => {
			await run(Effect.logInfo("hello"));
			expect(output()).toContain("hello");
		});

		it("Step.success outside a withStep envelope is a no-op", async () => {
			// Should not throw and should produce no success-line output.
			await run(Step.success("stray success"));
			expect(output()).not.toContain("stray success");
		});
	});
});
