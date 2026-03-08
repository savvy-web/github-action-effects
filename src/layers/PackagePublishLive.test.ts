import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { CommandRunnerError } from "../errors/CommandRunnerError.js";
import type { ExecOutput } from "../services/CommandRunner.js";
import { CommandRunner } from "../services/CommandRunner.js";
import { PackagePublish } from "../services/PackagePublish.js";
import { NpmRegistryTest } from "./NpmRegistryTest.js";
import { PackagePublishLive } from "./PackagePublishLive.js";

const makeMockRunner = (handlers: {
	exec?: (command: string, args: ReadonlyArray<string>) => Effect.Effect<number, CommandRunnerError>;
	execCapture?: (command: string, args: ReadonlyArray<string>) => Effect.Effect<ExecOutput, CommandRunnerError>;
}) =>
	Layer.succeed(CommandRunner, {
		exec: handlers.exec ?? (() => Effect.succeed(0)),
		execCapture: handlers.execCapture ?? (() => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" })),
		execJson: () => Effect.die("not used"),
		execLines: () => Effect.die("not used"),
	} as CommandRunner);

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
});
