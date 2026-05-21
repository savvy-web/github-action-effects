import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { CommandRunnerError } from "../errors/CommandRunnerError.js";
import { PackagePublishError } from "../errors/PackagePublishError.js";
import type { ExecOptions, ExecOutput } from "../services/CommandRunner.js";
import { CommandRunner } from "../services/CommandRunner.js";
import { PackagePublish } from "../services/PackagePublish.js";
import { NpmRegistryTest } from "./NpmRegistryTest.js";
import { PackagePublishLive } from "./PackagePublishLive.js";

const makeMockRunner = (handlers: {
	exec?: (
		command: string,
		args: ReadonlyArray<string>,
		options?: ExecOptions,
	) => Effect.Effect<number, CommandRunnerError>;
	execCapture?: (
		command: string,
		args: ReadonlyArray<string>,
		options?: ExecOptions,
	) => Effect.Effect<ExecOutput, CommandRunnerError>;
}) =>
	Layer.succeed(CommandRunner, {
		exec: handlers.exec ?? (() => Effect.succeed(0)),
		execCapture: handlers.execCapture ?? (() => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" })),
		execJson: () => Effect.die("not used"),
		execLines: () => Effect.die("not used"),
	} as typeof CommandRunner.Service);

describe("PackagePublishLive", () => {
	it("setupAuth runs npm config set with registry token", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.setupAuth("npm.pkg.github.com", "ghp_token")),
				Effect.provide(layer),
			),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("npm");
		expect(calls[0]?.args).toEqual(["config", "set", "//npm.pkg.github.com:_authToken", "ghp_token"]);
	});

	it("setupAuth strips the URL scheme when given a full registry URL", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.setupAuth("https://npm.pkg.github.com/", "ghp_token")),
				Effect.provide(layer),
			),
		);

		// npm matches `//npm.pkg.github.com/:_authToken`; keeping the scheme
		// (`//https://…`) yields a key npm never matches → ENEEDAUTH.
		expect(calls[0]?.args).toEqual(["config", "set", "//npm.pkg.github.com/:_authToken", "ghp_token"]);
	});

	it("publish runs npm publish with flags", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) =>
					svc.publish("/pkg", {
						registry: "https://registry.npmjs.org",
						tag: "latest",
						access: "public",
						provenance: true,
					}),
				),
				Effect.provide(layer),
			),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.args).toEqual([
			"publish",
			"--registry",
			"https://registry.npmjs.org",
			"--tag",
			"latest",
			"--access",
			"public",
			"--provenance",
			"--loglevel",
			"verbose",
		]);
	});

	it("verifyIntegrity returns true when registry integrity matches", async () => {
		const runner = makeMockRunner({});
		const registry = NpmRegistryTest.layer({
			packages: new Map([
				[
					"my-pkg",
					{
						versions: ["1.0.0"],
						latest: "1.0.0",
						distTags: { latest: "1.0.0" },
						integrity: "sha512-abc123",
					},
				],
			]),
		});
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.verifyIntegrity("my-pkg", "1.0.0", "sha512-abc123")),
				Effect.provide(layer),
			),
		);

		expect(result).toBe(true);
	});

	it("verifyIntegrity returns false when integrity does not match", async () => {
		const runner = makeMockRunner({});
		const registry = NpmRegistryTest.layer({
			packages: new Map([
				[
					"my-pkg",
					{
						versions: ["1.0.0"],
						latest: "1.0.0",
						distTags: { latest: "1.0.0" },
						integrity: "sha512-abc123",
					},
				],
			]),
		});
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.verifyIntegrity("my-pkg", "1.0.0", "sha512-wrong")),
				Effect.provide(layer),
			),
		);

		expect(result).toBe(false);
	});

	it("publish runs npm publish with no options", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg")),
				Effect.provide(layer),
			),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.args).toEqual(["publish", "--loglevel", "verbose"]);
	});

	it("publish includes only registry flag when only registry is set", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { registry: "https://registry.npmjs.org" })),
				Effect.provide(layer),
			),
		);

		expect(calls[0]?.args).toEqual(["publish", "--registry", "https://registry.npmjs.org", "--loglevel", "verbose"]);
	});

	it("publish includes only tag flag when only tag is set", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { tag: "beta" })),
				Effect.provide(layer),
			),
		);

		expect(calls[0]?.args).toEqual(["publish", "--tag", "beta", "--loglevel", "verbose"]);
	});

	it("publish includes only access flag when only access is set", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { access: "restricted" })),
				Effect.provide(layer),
			),
		);

		expect(calls[0]?.args).toEqual(["publish", "--access", "restricted", "--loglevel", "verbose"]);
	});

	it("publish includes only provenance flag when only provenance is set", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { provenance: true })),
				Effect.provide(layer),
			),
		);

		expect(calls[0]?.args).toEqual(["publish", "--provenance", "--loglevel", "verbose"]);
	});

	it("publish does not include provenance flag when provenance is false", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { provenance: false })),
				Effect.provide(layer),
			),
		);

		expect(calls[0]?.args).toEqual(["publish", "--loglevel", "verbose"]);
	});

	it("publish dispatches through `pnpm dlx npm` when packageManager is pnpm", async () => {
		// Critical for npm trusted publishing: `pnpm dlx npm` fetches a fresh
		// npm rather than using the runner's bundled npm. Node 24 ships npm
		// 10.x, which has no OIDC token-exchange support; `pnpm dlx npm`
		// pulls npm 11.5.1+, which does. The cmd flips from "npm" to "pnpm",
		// and "dlx", "npm" is prepended to the publish args.
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) =>
					svc.publish("/pkg", {
						registry: "https://registry.npmjs.org",
						access: "public",
						provenance: true,
						packageManager: "pnpm",
					}),
				),
				Effect.provide(layer),
			),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("pnpm");
		expect(calls[0]?.args).toEqual([
			"dlx",
			"npm",
			"publish",
			"--registry",
			"https://registry.npmjs.org",
			"--access",
			"public",
			"--provenance",
			"--loglevel",
			"verbose",
		]);
	});

	it("publish dispatches through `yarn npm` when packageManager is yarn", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { packageManager: "yarn" })),
				Effect.provide(layer),
			),
		);

		expect(calls[0]?.command).toBe("yarn");
		expect(calls[0]?.args).toEqual(["npm", "publish", "--loglevel", "verbose"]);
	});

	it("publish dispatches through `bun x npm` when packageManager is bun", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { packageManager: "bun" })),
				Effect.provide(layer),
			),
		);

		expect(calls[0]?.command).toBe("bun");
		expect(calls[0]?.args).toEqual(["x", "npm", "publish", "--loglevel", "verbose"]);
	});

	it("publish keeps the bare `npm` dispatch when packageManager is unset or 'npm'", async () => {
		// Default preserves the prior behaviour for callers that haven't
		// opted in. The runner's bundled npm is used.
		const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
		const runner = makeMockRunner({
			exec: (command, args) => {
				calls.push({ command, args });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { packageManager: "npm" })),
				Effect.provide(layer),
			),
		);

		expect(calls[0]?.command).toBe("npm");
		expect(calls[0]?.args[0]).toBe("publish");
	});

	it("publish wraps CommandRunnerError into PackagePublishError", async () => {
		const runner = makeMockRunner({
			exec: () =>
				Effect.fail(
					new CommandRunnerError({
						command: "npm",
						args: ["publish"],
						exitCode: 1,
						stderr: "auth required",
						reason: "Command failed with exit code 1",
					}),
				),
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { registry: "https://registry.npmjs.org" })),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("publish");
		expect(error.registry).toBe("https://registry.npmjs.org");
		expect(error.reason).toBe("Command failed with exit code 1");
	});

	it("publish carries the CommandRunnerError as cause on failure", async () => {
		const sourceError = new CommandRunnerError({
			command: "npm",
			args: ["publish"],
			exitCode: 1,
			stderr: "npm error 403 Forbidden",
			reason: "Command failed with exit code 1",
		});
		const runner = makeMockRunner({
			exec: () => Effect.fail(sourceError),
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg", { registry: "https://registry.npmjs.org" })),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("publish");
		expect(error.cause).toBe(sourceError);
		expect((error.cause as CommandRunnerError)._tag).toBe("CommandRunnerError");
		expect((error.cause as CommandRunnerError).stderr).toBe("npm error 403 Forbidden");
	});

	it("publish error omits registry field when registry option is not provided", async () => {
		const runner = makeMockRunner({
			exec: () =>
				Effect.fail(
					new CommandRunnerError({
						command: "npm",
						args: ["publish"],
						exitCode: 1,
						stderr: "",
						reason: "failed",
					}),
				),
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/pkg")),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("publish");
		expect(error.registry).toBeUndefined();
	});

	it("setupAuth wraps CommandRunnerError into PackagePublishError", async () => {
		const runner = makeMockRunner({
			exec: () =>
				Effect.fail(
					new CommandRunnerError({
						command: "npm",
						args: ["config", "set"],
						exitCode: 1,
						stderr: "",
						reason: "config set failed",
					}),
				),
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.setupAuth("npm.pkg.github.com", "token")),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("setupAuth");
		expect(error.registry).toBe("npm.pkg.github.com");
		expect(error.reason).toBe("config set failed");
	});

	it("pack fails with PackagePublishError when npm pack returns invalid JSON", async () => {
		const runner = makeMockRunner({
			execCapture: () => Effect.succeed({ exitCode: 0, stdout: "not json", stderr: "" }),
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.pack("/pkg")),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("pack");
		expect(error.reason).toContain("Failed to parse npm pack JSON output");
	});

	it("pack fails with PackagePublishError when npm pack returns empty array", async () => {
		const runner = makeMockRunner({
			execCapture: () => Effect.succeed({ exitCode: 0, stdout: "[]", stderr: "" }),
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.pack("/pkg")),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("pack");
		expect(error.reason).toBe("npm pack returned empty result");
	});

	it("pack wraps CommandRunnerError from execCapture into PackagePublishError", async () => {
		const runner = makeMockRunner({
			execCapture: () =>
				Effect.fail(
					new CommandRunnerError({
						command: "npm",
						args: ["pack", "--json"],
						exitCode: 1,
						stderr: "pack failed",
						reason: "Command failed with exit code 1",
					}),
				),
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.pack("/pkg")),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("pack");
		expect(error.reason).toBe("Command failed with exit code 1");
	});

	it("verifyIntegrity wraps NpmRegistryError into PackagePublishError", async () => {
		const runner = makeMockRunner({});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.verifyIntegrity("nonexistent-pkg", "1.0.0", "sha512-abc")),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("verifyIntegrity");
		expect(error.pkg).toBe("nonexistent-pkg");
		expect(error.reason).toContain("not found in test state");
	});

	it("publishToRegistries sets auth and publishes for each registry", async () => {
		const calls: Array<{ command: string; args: ReadonlyArray<string>; cwd: string | undefined }> = [];
		const runner = makeMockRunner({
			exec: (command, args, options) => {
				calls.push({ command, args, cwd: options?.cwd });
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) =>
					svc.publishToRegistries("/pkg", [
						{ registry: "https://registry.npmjs.org", token: "npm-token", tag: "latest", access: "public" },
						{ registry: "https://npm.pkg.github.com", token: "ghp-token" },
					]),
				),
				Effect.provide(layer),
			),
		);

		// First registry: auth + publish with tag and access
		expect(calls[0]?.args).toEqual(["config", "set", "//registry.npmjs.org:_authToken", "npm-token"]);
		expect(calls[1]?.args).toEqual([
			"publish",
			"--registry",
			"https://registry.npmjs.org",
			"--tag",
			"latest",
			"--access",
			"public",
			"--loglevel",
			"verbose",
		]);
		expect(calls[1]?.cwd).toBe("/pkg");

		// Second registry: auth + publish without tag/access
		expect(calls[2]?.args).toEqual(["config", "set", "//npm.pkg.github.com:_authToken", "ghp-token"]);
		expect(calls[3]?.args).toEqual(["publish", "--registry", "https://npm.pkg.github.com", "--loglevel", "verbose"]);
		expect(calls[3]?.cwd).toBe("/pkg");
	});

	it("publishToRegistries wraps CommandRunnerError into PackagePublishError", async () => {
		const runner = makeMockRunner({
			exec: (_command, args) => {
				if (args[0] === "publish") {
					return Effect.fail(
						new CommandRunnerError({
							command: "npm",
							args: ["publish"],
							exitCode: 1,
							stderr: "",
							reason: "publish failed",
						}),
					);
				}
				return Effect.succeed(0);
			},
		});
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) =>
					svc.publishToRegistries("/pkg", [{ registry: "https://registry.npmjs.org", token: "token" }]),
				),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("publishToRegistries");
		expect(error.reason).toBe("publish failed");
	});

	it("publishToRegistries wraps non-reason errors into PackagePublishError with String fallback", async () => {
		const runner = Layer.succeed(CommandRunner, {
			exec: (_command: string, args?: ReadonlyArray<string>) => {
				if (args?.[0] === "publish") {
					return Effect.fail("plain string error" as unknown as CommandRunnerError);
				}
				return Effect.succeed(0);
			},
			execCapture: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
			execJson: () => Effect.die("not used"),
			execLines: () => Effect.die("not used"),
		} as unknown as typeof CommandRunner.Service);
		const registry = NpmRegistryTest.empty();
		const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

		const error = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) =>
					svc.publishToRegistries("/pkg", [{ registry: "https://registry.npmjs.org", token: "token" }]),
				),
				Effect.provide(layer),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PackagePublishError);
		expect(error.operation).toBe("publishToRegistries");
		expect(error.reason).toBe("plain string error");
	});

	describe("dryRun", () => {
		it("returns ok: true with size fields when npm exits cleanly", async () => {
			const calls: Array<{ command: string; args: ReadonlyArray<string>; cwd: string | undefined }> = [];
			const runner = makeMockRunner({
				execCapture: (command, args, options) => {
					calls.push({ command, args, cwd: options?.cwd });
					// `npm publish --dry-run --json` emits a single JSON object —
					// not an array (that is `npm pack --dry-run --json`).
					return Effect.succeed({
						exitCode: 0,
						stdout: JSON.stringify({ size: 1234, unpackedSize: 5678, entryCount: 9 }),
						stderr: "",
					});
				},
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const result = await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) =>
						svc.dryRun("/pkg", {
							registry: "https://registry.npmjs.org",
							tag: "latest",
							access: "public",
							provenance: true,
						}),
					),
					Effect.provide(layer),
				),
			);

			expect(result.ok).toBe(true);
			expect(result.packedSize).toBe(1234);
			expect(result.unpackedSize).toBe(5678);
			expect(result.fileCount).toBe(9);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.command).toBe("npm");
			expect(calls[0]?.args).toEqual([
				"publish",
				"--dry-run",
				"--json",
				"--registry",
				"https://registry.npmjs.org",
				"--tag",
				"latest",
				"--access",
				"public",
				"--provenance",
			]);
			expect(calls[0]?.cwd).toBe("/pkg");
		});

		it("returns size fields when npm emits the array form (npm pack shape)", async () => {
			const runner = makeMockRunner({
				execCapture: () =>
					Effect.succeed({
						exitCode: 0,
						stdout: JSON.stringify([{ size: 42, unpackedSize: 84, entryCount: 3 }]),
						stderr: "",
					}),
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const result = await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) => svc.dryRun("/pkg")),
					Effect.provide(layer),
				),
			);

			expect(result.ok).toBe(true);
			expect(result.packedSize).toBe(42);
			expect(result.unpackedSize).toBe(84);
			expect(result.fileCount).toBe(3);
		});

		it("returns ok: false (not an Effect failure) when npm exits non-zero", async () => {
			const runner = makeMockRunner({
				execCapture: () =>
					Effect.fail(
						new CommandRunnerError({
							command: "npm",
							args: ["publish", "--dry-run", "--json"],
							exitCode: 1,
							stderr: "E403 Forbidden",
							reason: "Command failed with exit code 1",
						}),
					),
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const result = await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) => svc.dryRun("/pkg")),
					Effect.provide(layer),
				),
			);

			expect(result.ok).toBe(false);
			expect(result.output).toContain("E403");
		});

		it("fails with PackagePublishError when npm output is unparseable JSON", async () => {
			const runner = makeMockRunner({
				execCapture: () => Effect.succeed({ exitCode: 0, stdout: "not valid json", stderr: "" }),
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const error = await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) => svc.dryRun("/pkg")),
					Effect.provide(layer),
					Effect.flip,
				),
			);

			expect(error).toBeInstanceOf(PackagePublishError);
			expect(error.operation).toBe("dryRun");
		});
	});

	describe("publishIdempotent", () => {
		it("publishes when the version is absent from the registry", async () => {
			const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
			const runner = makeMockRunner({
				exec: (command, args) => {
					calls.push({ command, args });
					return Effect.succeed(0);
				},
			});
			const registry = NpmRegistryTest.layer({
				packages: new Map([["my-pkg", { versions: [], latest: "", distTags: {} }]]),
			});
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const result = await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) =>
						svc.publishIdempotent({
							packageDir: "/pkg",
							packageName: "my-pkg",
							version: "1.0.0",
							digest: "sha512-abc123",
						}),
					),
					Effect.provide(layer),
				),
			);

			expect(result).toEqual({ status: "published", packageName: "my-pkg", version: "1.0.0" });
			expect(calls).toHaveLength(1);
			expect(calls[0]?.args[0]).toBe("publish");
		});

		it("skips when an identical version is already published", async () => {
			const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
			const runner = makeMockRunner({
				exec: (command, args) => {
					calls.push({ command, args });
					return Effect.succeed(0);
				},
			});
			const registry = NpmRegistryTest.layer({
				packages: new Map([
					[
						"my-pkg",
						{ versions: ["1.0.0"], latest: "1.0.0", distTags: { latest: "1.0.0" }, integrity: "sha512-abc123" },
					],
				]),
			});
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const result = await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) =>
						svc.publishIdempotent({
							packageDir: "/pkg",
							packageName: "my-pkg",
							version: "1.0.0",
							digest: "sha512-abc123",
						}),
					),
					Effect.provide(layer),
				),
			);

			expect(result).toEqual({
				status: "skipped",
				packageName: "my-pkg",
				version: "1.0.0",
				skipReason: "already-published-identical",
			});
			expect(calls).toHaveLength(0);
		});

		it("fails when the published version has a different integrity hash", async () => {
			const runner = makeMockRunner({});
			const registry = NpmRegistryTest.layer({
				packages: new Map([
					[
						"my-pkg",
						{ versions: ["1.0.0"], latest: "1.0.0", distTags: { latest: "1.0.0" }, integrity: "sha512-published" },
					],
				]),
			});
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const exit = await Effect.runPromiseExit(
				PackagePublish.pipe(
					Effect.flatMap((svc) =>
						svc.publishIdempotent({
							packageDir: "/pkg",
							packageName: "my-pkg",
							version: "1.0.0",
							digest: "sha512-localbuild",
						}),
					),
					Effect.provide(layer),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("pack (happy path)", () => {
		it("populates name, version, sizes, file count, and integrity from npm pack --json", async () => {
			// Use a real temp dir + real placeholder tarball so the
			// pack method can hash it for sha256Hex. The npm pack --json
			// output is mocked; the file's bytes just need to exist.
			const { mkdtempSync, writeFileSync } = await import("node:fs");
			const { tmpdir } = await import("node:os");
			const { join } = await import("node:path");
			const { createHash } = await import("node:crypto");
			const dir = mkdtempSync(join(tmpdir(), "pack-test-"));
			const tarballName = "my-pkg-2.1.0.tgz";
			const tarballBytes = Buffer.from("fixture tarball bytes");
			writeFileSync(join(dir, tarballName), tarballBytes);
			const expectedSha256 = createHash("sha256").update(tarballBytes).digest("hex");

			// Fixture mirrors the real shape of `npm pack --json`: an array of
			// entries with name/version/size/unpackedSize/entryCount/integrity.
			// All non-tarball fields flow into PackResult, so callers don't
			// need to re-parse npm's output downstream.
			const fixture = JSON.stringify([
				{
					id: "my-pkg@2.1.0",
					name: "my-pkg",
					version: "2.1.0",
					size: 4096,
					unpackedSize: 16384,
					shasum: "deadbeef",
					integrity: "sha512-Yqxw3FaA==",
					filename: tarballName,
					entryCount: 7,
				},
			]);
			const runner = makeMockRunner({
				execCapture: () => Effect.succeed({ exitCode: 0, stdout: fixture, stderr: "" }),
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const result = await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) => svc.pack(dir)),
					Effect.provide(layer),
				),
			);

			expect(result).toEqual({
				tarballPath: join(dir, tarballName),
				digest: "sha512-Yqxw3FaA==",
				sha256Hex: expectedSha256,
				name: "my-pkg",
				version: "2.1.0",
				packedSize: 4096,
				unpackedSize: 16384,
				fileCount: 7,
			});
		});

		it("fails when npm pack omits the integrity field", async () => {
			// Without `integrity`, there is no value to compare against the
			// registry's `dist.integrity`. Surfacing a clear error is better
			// than silently returning a placeholder.
			const fixture = JSON.stringify([
				{
					name: "my-pkg",
					version: "1.0.0",
					filename: "my-pkg-1.0.0.tgz",
					size: 100,
					unpackedSize: 200,
					entryCount: 3,
				},
			]);
			const runner = makeMockRunner({
				execCapture: () => Effect.succeed({ exitCode: 0, stdout: fixture, stderr: "" }),
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const error = await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) => svc.pack("/pkg")),
					Effect.provide(layer),
					Effect.flip,
				),
			);
			expect(error).toBeInstanceOf(PackagePublishError);
			expect(error.operation).toBe("pack");
			expect(error.reason).toContain("missing integrity");
		});
	});

	describe("publishTarball", () => {
		it("invokes npm publish <tarballPath> --registry <url> with no cwd", async () => {
			const calls: Array<{ command: string; args: ReadonlyArray<string>; cwd: string | undefined }> = [];
			const runner = makeMockRunner({
				exec: (command, args, options) => {
					calls.push({ command, args, cwd: options?.cwd });
					return Effect.succeed(0);
				},
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) =>
						svc.publishTarball("/tmp/my-pkg-2.0.0.tgz", {
							registry: "https://registry.npmjs.org/",
							access: "public",
							provenance: true,
							tag: "next",
						}),
					),
					Effect.provide(layer),
				),
			);

			expect(calls).toHaveLength(1);
			expect(calls[0]?.command).toBe("npm");
			expect(calls[0]?.args).toEqual([
				"publish",
				"/tmp/my-pkg-2.0.0.tgz",
				"--registry",
				"https://registry.npmjs.org/",
				"--access",
				"public",
				"--provenance",
				"--tag",
				"next",
				"--loglevel",
				"verbose",
			]);
			// publishTarball does NOT set cwd — the tarball path is absolute.
			expect(calls[0]?.cwd).toBeUndefined();
		});

		it("omits --access, --provenance, and --tag when not provided", async () => {
			const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
			const runner = makeMockRunner({
				exec: (command, args) => {
					calls.push({ command, args });
					return Effect.succeed(0);
				},
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) => svc.publishTarball("/tmp/pkg.tgz", { registry: "https://registry.npmjs.org/" })),
					Effect.provide(layer),
				),
			);

			expect(calls[0]?.args).toEqual([
				"publish",
				"/tmp/pkg.tgz",
				"--registry",
				"https://registry.npmjs.org/",
				"--loglevel",
				"verbose",
			]);
		});

		it("dispatches through `pnpm dlx npm` when packageManager is pnpm", async () => {
			const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
			const runner = makeMockRunner({
				exec: (command, args) => {
					calls.push({ command, args });
					return Effect.succeed(0);
				},
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) =>
						svc.publishTarball("/tmp/pkg.tgz", {
							registry: "https://registry.npmjs.org/",
							packageManager: "pnpm",
						}),
					),
					Effect.provide(layer),
				),
			);

			expect(calls[0]?.command).toBe("pnpm");
			expect(calls[0]?.args).toEqual([
				"dlx",
				"npm",
				"publish",
				"/tmp/pkg.tgz",
				"--registry",
				"https://registry.npmjs.org/",
				"--loglevel",
				"verbose",
			]);
		});

		it("wraps CommandRunnerError into PackagePublishError with the registry attached", async () => {
			const runner = makeMockRunner({
				exec: () =>
					Effect.fail(
						new CommandRunnerError({
							command: "npm",
							args: ["publish"],
							exitCode: 1,
							stderr: "npm error 403 Forbidden",
							reason: "Command failed with exit code 1",
						}),
					),
			});
			const registry = NpmRegistryTest.empty();
			const layer = PackagePublishLive.pipe(Layer.provide(Layer.merge(runner, registry)));

			const error = await Effect.runPromise(
				PackagePublish.pipe(
					Effect.flatMap((svc) => svc.publishTarball("/tmp/pkg.tgz", { registry: "https://npm.pkg.github.com/" })),
					Effect.provide(layer),
					Effect.flip,
				),
			);

			expect(error).toBeInstanceOf(PackagePublishError);
			expect(error.operation).toBe("publishTarball");
			expect(error.registry).toBe("https://npm.pkg.github.com/");
			expect(error.reason).toBe("Command failed with exit code 1");
			expect((error.cause as CommandRunnerError).stderr).toBe("npm error 403 Forbidden");
		});
	});
});
