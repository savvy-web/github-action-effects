import { Effect, Layer } from "effect";
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
		expect(calls[0]?.args).toEqual(["publish"]);
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

		expect(calls[0]?.args).toEqual(["publish", "--registry", "https://registry.npmjs.org"]);
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

		expect(calls[0]?.args).toEqual(["publish", "--tag", "beta"]);
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

		expect(calls[0]?.args).toEqual(["publish", "--access", "restricted"]);
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

		expect(calls[0]?.args).toEqual(["publish", "--provenance"]);
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

		expect(calls[0]?.args).toEqual(["publish"]);
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
		expect(calls[0]?.args).toEqual(["config", "set", "//https://registry.npmjs.org:_authToken", "npm-token"]);
		expect(calls[1]?.args).toEqual([
			"publish",
			"--registry",
			"https://registry.npmjs.org",
			"--tag",
			"latest",
			"--access",
			"public",
		]);
		expect(calls[1]?.cwd).toBe("/pkg");

		// Second registry: auth + publish without tag/access
		expect(calls[2]?.args).toEqual(["config", "set", "//https://npm.pkg.github.com:_authToken", "ghp-token"]);
		expect(calls[3]?.args).toEqual(["publish", "--registry", "https://npm.pkg.github.com"]);
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
});
