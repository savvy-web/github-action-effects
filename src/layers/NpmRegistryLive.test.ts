import { Effect, Layer, LogLevel, Logger, Option } from "effect";
import { describe, expect, it } from "vitest";
import { CommandRunnerError } from "../errors/CommandRunnerError.js";
import type { ExecOutput } from "../services/CommandRunner.js";
import { CommandRunner } from "../services/CommandRunner.js";
import { NpmRegistry } from "../services/NpmRegistry.js";
import { NpmRegistryLive } from "./NpmRegistryLive.js";

const makeMockRunner = (responses: Map<string, string>) =>
	Layer.succeed(CommandRunner, {
		exec: () => Effect.die("not used"),
		execCapture: (_command: string, args?: ReadonlyArray<string>) => {
			// Build a key from the args to identify the call
			const key = args?.join(" ") ?? "";
			for (const [pattern, response] of responses) {
				if (key.includes(pattern)) {
					return Effect.succeed({
						exitCode: 0,
						stdout: response,
						stderr: "",
					});
				}
			}
			return Effect.fail(
				new CommandRunnerError({
					command: `npm ${key}`,
					args: args ?? [],
					exitCode: 1,
					stderr: undefined,
					reason: `No mock response for: npm ${key}`,
				}),
			);
		},
		execJson: () => Effect.die("not used"),
		execLines: () => Effect.die("not used"),
	} as typeof CommandRunner.Service);

/**
 * Captures every `execCapture` invocation so a test can assert against the
 * args the live layer actually passed to npm. The `respond` callback picks a
 * response (or an error) per call by inspecting the args.
 */
const makeCapturingRunner = (
	respond: (args: ReadonlyArray<string>) => Effect.Effect<ExecOutput, CommandRunnerError>,
) => {
	const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
	const layer = Layer.succeed(CommandRunner, {
		exec: () => Effect.die("not used"),
		execCapture: (command: string, args?: ReadonlyArray<string>) => {
			const a = args ?? [];
			calls.push({ command, args: a });
			return respond(a);
		},
		execJson: () => Effect.die("not used"),
		execLines: () => Effect.die("not used"),
	} as typeof CommandRunner.Service);
	return { calls, layer };
};

/**
 * Run a getPublishedIntegrity probe with the live layer + a captured runner.
 *
 * @remarks
 * `Effect.gen` inside `getPublishedIntegrity` leaks its R-channel through
 * tsgo's type erasure even after the layer is provided, which propagates
 * up the `NpmRegistry.pipe(Effect.flatMap(...))` chain at the call site
 * and makes the `pipe` itself ill-typed. Wrapping the chain in this helper
 * lets the cast live in one place rather than smearing across every test.
 */
const runIntegrityProbe = (
	layer: Layer.Layer<NpmRegistry>,
	pkg: string,
	version: string,
	options: { registry: string },
): Promise<Option.Option<string>> => {
	const program = Effect.gen(function* () {
		const reg = yield* NpmRegistry;
		return yield* reg.getPublishedIntegrity(pkg, version, options);
	});
	return Effect.runPromise(
		program.pipe(Effect.provide(layer), Logger.withMinimumLogLevel(LogLevel.None)) as Effect.Effect<
			Option.Option<string>,
			never,
			never
		>,
	);
};

/**
 * Same wrapper as {@link runIntegrityProbe}, but surfaces the error channel
 * (via `Effect.flip`) for tests asserting propagation.
 */
const runIntegrityProbeError = (
	layer: Layer.Layer<NpmRegistry>,
	pkg: string,
	version: string,
	options: { registry: string },
): Promise<unknown> => {
	const program = Effect.gen(function* () {
		const reg = yield* NpmRegistry;
		return yield* reg.getPublishedIntegrity(pkg, version, options);
	});
	return Effect.runPromise(
		program.pipe(Effect.provide(layer), Effect.flip, Logger.withMinimumLogLevel(LogLevel.None)) as Effect.Effect<
			unknown,
			never,
			never
		>,
	);
};

describe("NpmRegistryLive", () => {
	it("getLatestVersion parses npm view output", async () => {
		const runner = makeMockRunner(new Map([["dist-tags.latest", '"3.2.0"']]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getLatestVersion("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toBe("3.2.0");
	});

	it("getDistTags parses dist-tags object", async () => {
		const runner = makeMockRunner(new Map([["dist-tags --json", JSON.stringify({ latest: "3.2.0", next: "4.0.0" })]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getDistTags("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual({ latest: "3.2.0", next: "4.0.0" });
	});

	it("getVersions parses versions array", async () => {
		const runner = makeMockRunner(new Map([["versions --json", JSON.stringify(["1.0.0", "2.0.0"])]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getVersions("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual(["1.0.0", "2.0.0"]);
	});

	it("getVersions handles single version string", async () => {
		const runner = makeMockRunner(new Map([["versions --json", '"1.0.0"']]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getVersions("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual(["1.0.0"]);
	});

	it("getVersions appends --registry when registry option is supplied", async () => {
		const { calls, layer: runner } = makeCapturingRunner(() =>
			Effect.succeed({ exitCode: 0, stdout: JSON.stringify(["1.0.0"]), stderr: "" }),
		);
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getVersions("my-pkg", { registry: "https://npm.pkg.github.com/" })),
				Effect.provide(layer),
			),
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.args).toEqual([
			"view",
			"my-pkg",
			"versions",
			"--json",
			"--registry",
			"https://npm.pkg.github.com/",
		]);
	});

	it("getVersions omits --registry when no option is supplied", async () => {
		const { calls, layer: runner } = makeCapturingRunner(() =>
			Effect.succeed({ exitCode: 0, stdout: JSON.stringify(["1.0.0"]), stderr: "" }),
		);
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getVersions("my-pkg")),
				Effect.provide(layer),
			),
		);
		expect(calls[0]?.args).toEqual(["view", "my-pkg", "versions", "--json"]);
		expect(calls[0]?.args).not.toContain("--registry");
	});

	it("getPackageInfo reads flat dot-notation keys from npm view", async () => {
		const npmOutput = JSON.stringify({
			name: "effect",
			version: "3.2.0",
			"dist-tags": { latest: "3.2.0" },
			"dist.integrity": "sha512-abc",
			"dist.tarball": "https://registry.npmjs.org/effect/-/effect-3.2.0.tgz",
		});
		const runner = makeMockRunner(new Map([["name version dist-tags", npmOutput]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getPackageInfo("effect")),
				Effect.provide(layer),
			),
		);
		expect(result.name).toBe("effect");
		expect(result.version).toBe("3.2.0");
		expect(result.distTags).toEqual({ latest: "3.2.0" });
		expect(result.integrity).toBe("sha512-abc");
		expect(result.tarball).toBe("https://registry.npmjs.org/effect/-/effect-3.2.0.tgz");
	});

	it("getPackageInfo falls back to nested dist object", async () => {
		const npmOutput = JSON.stringify({
			name: "effect",
			version: "3.2.0",
			"dist-tags": { latest: "3.2.0" },
			dist: {
				integrity: "sha512-nested",
				tarball: "https://example.com/effect.tgz",
			},
		});
		const runner = makeMockRunner(new Map([["name version dist-tags", npmOutput]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getPackageInfo("effect")),
				Effect.provide(layer),
			),
		);
		expect(result.integrity).toBe("sha512-nested");
		expect(result.tarball).toBe("https://example.com/effect.tgz");
	});

	it("getPackageInfo appends --registry when registry option is supplied", async () => {
		const { calls, layer: runner } = makeCapturingRunner(() =>
			Effect.succeed({
				exitCode: 0,
				stdout: JSON.stringify({ name: "effect", version: "3.2.0", "dist-tags": {} }),
				stderr: "",
			}),
		);
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getPackageInfo("effect", "3.2.0", { registry: "https://registry.npmjs.org/" })),
				Effect.provide(layer),
			),
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.args).toEqual([
			"view",
			"effect@3.2.0",
			"name",
			"version",
			"dist-tags",
			"dist.integrity",
			"dist.tarball",
			"--json",
			"--registry",
			"https://registry.npmjs.org/",
		]);
	});

	it("getPackageInfo omits --registry when no option is supplied", async () => {
		const { calls, layer: runner } = makeCapturingRunner(() =>
			Effect.succeed({
				exitCode: 0,
				stdout: JSON.stringify({ name: "effect", version: "3.2.0", "dist-tags": {} }),
				stderr: "",
			}),
		);
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getPackageInfo("effect")),
				Effect.provide(layer),
			),
		);
		expect(calls[0]?.args).not.toContain("--registry");
	});

	it("getLatestVersion returns non-string data as string via String()", async () => {
		// When npm returns a non-string JSON value (e.g. a number), it should be converted via String()
		const runner = makeMockRunner(new Map([["dist-tags.latest", "42"]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getLatestVersion("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toBe("42");
	});

	it("getVersions returns empty array for non-array non-string data", async () => {
		// When npm returns an object (not array, not string), getVersions should return []
		const runner = makeMockRunner(new Map([["versions --json", JSON.stringify({ something: true })]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getVersions("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual([]);
	});

	it("maps CommandRunnerError to NpmRegistryError", async () => {
		const runner = makeMockRunner(new Map());
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getLatestVersion("nonexistent")),
				Effect.catchAll((error) => Effect.succeed(error)),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveProperty("_tag", "NpmRegistryError");
		expect(result).toHaveProperty("pkg", "nonexistent");
	});

	describe("getPublishedIntegrity", () => {
		// Structured log lines emitted by getPublishedIntegrity are silenced
		// inside the helpers (see `Logger.withMinimumLogLevel(LogLevel.None)`).
		// The logs themselves are validated indirectly via the layer's
		// emission to the runner during real runs.

		it("returns Option.some(integrity) on a dist.integrity response", async () => {
			const { calls, layer: runner } = makeCapturingRunner(() =>
				Effect.succeed({
					exitCode: 0,
					stdout: JSON.stringify({ "dist.integrity": "sha512-abc123==" }),
					stderr: "",
				}),
			);
			const layer = NpmRegistryLive.pipe(Layer.provide(runner));
			const result = await runIntegrityProbe(layer, "my-pkg", "1.0.0", {
				registry: "https://registry.npmjs.org/",
			});
			expect(Option.isSome(result)).toBe(true);
			expect(Option.getOrNull(result)).toBe("sha512-abc123==");
			// Verifies the --registry flag is on the wire — the whole point
			// of getPublishedIntegrity is the per-target probe.
			expect(calls[0]?.args).toEqual([
				"view",
				"my-pkg@1.0.0",
				"dist.integrity",
				"--json",
				"--registry",
				"https://registry.npmjs.org/",
			]);
		});

		it("accepts the flat string form npm emits when one field is requested", async () => {
			// `npm view <pkg>@<ver> dist.integrity --json` for an existing
			// version flattens to a bare JSON string when exactly one field
			// is requested.
			const { layer: runner } = makeCapturingRunner(() =>
				Effect.succeed({
					exitCode: 0,
					stdout: '"sha512-flat=="',
					stderr: "",
				}),
			);
			const layer = NpmRegistryLive.pipe(Layer.provide(runner));
			const result = await runIntegrityProbe(layer, "my-pkg", "1.0.0", {
				registry: "https://registry.npmjs.org/",
			});
			expect(Option.getOrNull(result)).toBe("sha512-flat==");
		});

		it("accepts the nested dist.integrity form", async () => {
			const { layer: runner } = makeCapturingRunner(() =>
				Effect.succeed({
					exitCode: 0,
					stdout: JSON.stringify({ dist: { integrity: "sha512-nested==" } }),
					stderr: "",
				}),
			);
			const layer = NpmRegistryLive.pipe(Layer.provide(runner));
			const result = await runIntegrityProbe(layer, "my-pkg", "1.0.0", {
				registry: "https://registry.npmjs.org/",
			});
			expect(Option.getOrNull(result)).toBe("sha512-nested==");
		});

		it("returns Option.none() on an npm E404 (version not on the registry)", async () => {
			const { layer: runner } = makeCapturingRunner(() =>
				Effect.fail(
					new CommandRunnerError({
						command: "npm",
						args: ["view"],
						exitCode: 1,
						stderr: "npm error code E404\nnpm error 404 'my-pkg@1.0.0' is not in this registry.",
						reason: "Command failed with exit code 1",
					}),
				),
			);
			const layer = NpmRegistryLive.pipe(Layer.provide(runner));
			const result = await runIntegrityProbe(layer, "my-pkg", "1.0.0", {
				registry: "https://registry.npmjs.org/",
			});
			// E404 is the normal "version not published" branch; collapsing
			// it into Option.none() lets the orchestrator treat publish as
			// the default action without a special-case error catch.
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns Option.none() on an empty `{}` stdout (registry knows the name but version absent)", async () => {
			// Some registries return an empty JSON object rather than a 404 when
			// the version is not on file. Treat that as not-published.
			const { layer: runner } = makeCapturingRunner(() => Effect.succeed({ exitCode: 0, stdout: "{}", stderr: "" }));
			const layer = NpmRegistryLive.pipe(Layer.provide(runner));
			const result = await runIntegrityProbe(layer, "my-pkg", "1.0.0", {
				registry: "https://registry.npmjs.org/",
			});
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns Option.none() on completely empty stdout", async () => {
			const { layer: runner } = makeCapturingRunner(() => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }));
			const layer = NpmRegistryLive.pipe(Layer.provide(runner));
			const result = await runIntegrityProbe(layer, "my-pkg", "1.0.0", {
				registry: "https://registry.npmjs.org/",
			});
			expect(Option.isNone(result)).toBe(true);
		});

		it("propagates non-E404 CommandRunnerError as NpmRegistryError", async () => {
			// Network/auth failures must not collapse to Option.none() — that
			// would let an orchestrator publish over a version it can't see.
			const { layer: runner } = makeCapturingRunner(() =>
				Effect.fail(
					new CommandRunnerError({
						command: "npm",
						args: ["view"],
						exitCode: 1,
						stderr: "npm error network connect ETIMEDOUT",
						reason: "Command failed with exit code 1",
					}),
				),
			);
			const layer = NpmRegistryLive.pipe(Layer.provide(runner));
			const error = await runIntegrityProbeError(layer, "my-pkg", "1.0.0", {
				registry: "https://registry.npmjs.org/",
			});
			expect(error).toHaveProperty("_tag", "NpmRegistryError");
			expect(error).toHaveProperty("pkg", "my-pkg");
		});

		it("returns Option.none() when the response is parseable but has no integrity field", async () => {
			const { layer: runner } = makeCapturingRunner(() =>
				Effect.succeed({ exitCode: 0, stdout: JSON.stringify({ name: "my-pkg" }), stderr: "" }),
			);
			const layer = NpmRegistryLive.pipe(Layer.provide(runner));
			const result = await runIntegrityProbe(layer, "my-pkg", "1.0.0", {
				registry: "https://registry.npmjs.org/",
			});
			expect(Option.isNone(result)).toBe(true);
		});
	});
});
