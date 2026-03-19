import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { PackagePublishError } from "../errors/PackagePublishError.js";
import { CommandRunner } from "../services/CommandRunner.js";
import { NpmRegistry } from "../services/NpmRegistry.js";
import { PackagePublish } from "../services/PackagePublish.js";

/**
 * Live PackagePublish layer using CommandRunner and NpmRegistry.
 *
 * @public
 */
export const PackagePublishLive: Layer.Layer<PackagePublish, never, CommandRunner | NpmRegistry> = Layer.effect(
	PackagePublish,
	Effect.all([CommandRunner, NpmRegistry]).pipe(
		Effect.map(([runner, registry]) => ({
			setupAuth: (registryUrl: string, token: string) =>
				runner.exec("npm", ["config", "set", `//${registryUrl}:_authToken`, token]).pipe(
					Effect.asVoid,
					Effect.mapError(
						(error) =>
							new PackagePublishError({
								operation: "setupAuth",
								registry: registryUrl,
								reason: error.reason,
							}),
					),
				),

			pack: (packageDir: string) =>
				runner.execCapture("npm", ["pack", "--json"], { cwd: packageDir }).pipe(
					Effect.flatMap((output) =>
						Effect.try({
							try: () => JSON.parse(output.stdout) as Array<{ filename: string }>,
							catch: () =>
								new PackagePublishError({
									operation: "pack",
									reason: `Failed to parse npm pack JSON output: ${output.stdout.slice(0, 200)}`,
								}),
						}),
					),
					Effect.flatMap((entries) => {
						const first = entries[0];
						if (!first) {
							return Effect.fail(
								new PackagePublishError({
									operation: "pack",
									reason: "npm pack returned empty result",
								}),
							);
						}
						const tarballPath = join(packageDir, first.filename);
						return Effect.tryPromise({
							try: () => readFile(tarballPath),
							catch: () =>
								new PackagePublishError({
									operation: "pack",
									reason: `Failed to read tarball: ${tarballPath}`,
								}),
						}).pipe(
							Effect.map((buffer) => {
								const hash = createHash("sha256").update(buffer).digest("hex");
								return { tarball: first.filename, digest: `sha256-${hash}` };
							}),
						);
					}),
					Effect.mapError((error) =>
						error instanceof PackagePublishError
							? error
							: new PackagePublishError({
									operation: "pack",
									reason:
										typeof error === "object" && error !== null && "reason" in error
											? String(error.reason)
											: String(error),
								}),
					),
				),

			publish: (
				packageDir: string,
				options?: {
					readonly registry?: string;
					readonly tag?: string;
					readonly access?: "public" | "restricted";
					readonly provenance?: boolean;
				},
			) => {
				const args = ["publish"];
				if (options?.registry) args.push("--registry", options.registry);
				if (options?.tag) args.push("--tag", options.tag);
				if (options?.access) args.push("--access", options.access);
				if (options?.provenance) args.push("--provenance");

				return runner.exec("npm", args, { cwd: packageDir }).pipe(
					Effect.asVoid,
					Effect.mapError(
						(error) =>
							new PackagePublishError({
								operation: "publish",
								...(options?.registry !== undefined ? { registry: options.registry } : {}),
								reason: error.reason,
							}),
					),
				);
			},

			verifyIntegrity: (packageName: string, version: string, expectedDigest: string) =>
				registry.getPackageInfo(packageName, version).pipe(
					Effect.map((info) => info.integrity === expectedDigest),
					Effect.mapError(
						(error) =>
							new PackagePublishError({
								operation: "verifyIntegrity",
								pkg: packageName,
								reason: error.reason,
							}),
					),
				),

			publishToRegistries: (
				packageDir: string,
				registries: Array<{
					readonly registry: string;
					readonly token: string;
					readonly tag?: string;
					readonly access?: "public" | "restricted";
				}>,
			) =>
				Effect.forEach(
					registries,
					(target) =>
						runner.exec("npm", ["config", "set", `//${target.registry}:_authToken`, target.token]).pipe(
							Effect.asVoid,
							Effect.flatMap(() => {
								const args = ["publish"];
								args.push("--registry", target.registry);
								if (target.tag) args.push("--tag", target.tag);
								if (target.access) args.push("--access", target.access);
								return runner.exec("npm", args, { cwd: packageDir }).pipe(Effect.asVoid);
							}),
						),
					{ discard: true },
				).pipe(
					Effect.mapError(
						(error) =>
							new PackagePublishError({
								operation: "publishToRegistries",
								reason:
									typeof error === "object" && error !== null && "reason" in error
										? String(error.reason)
										: String(error),
							}),
					),
				),
		})),
	),
);
