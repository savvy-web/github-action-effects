import { Effect, Layer } from "effect";
import { NpmRegistryError } from "../errors/NpmRegistryError.js";
import { CommandRunner } from "../services/CommandRunner.js";
import { NpmRegistry } from "../services/NpmRegistry.js";

const parseJson = (
	pkg: string,
	operation: "view" | "search" | "versions",
	stdout: string,
): Effect.Effect<unknown, NpmRegistryError> =>
	Effect.try({
		try: () => JSON.parse(stdout) as unknown,
		catch: (error) =>
			new NpmRegistryError({
				pkg,
				operation,
				reason: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
			}),
	});

/**
 * Live NpmRegistry layer using CommandRunner.
 *
 * @public
 */
export const NpmRegistryLive: Layer.Layer<NpmRegistry, never, CommandRunner> = Layer.effect(
	NpmRegistry,
	Effect.map(CommandRunner, (runner) => ({
		getLatestVersion: (pkg: string) =>
			runner.execCapture("npm", ["view", pkg, "dist-tags.latest", "--json"]).pipe(
				Effect.mapError(
					(error) =>
						new NpmRegistryError({
							pkg,
							operation: "view",
							reason: error.reason,
						}),
				),
				Effect.flatMap((output) => parseJson(pkg, "view", output.stdout)),
				Effect.map((data) => {
					// npm view returns the value as a JSON string (with quotes)
					if (typeof data === "string") return data;
					return String(data);
				}),
			),

		getDistTags: (pkg: string) =>
			runner.execCapture("npm", ["view", pkg, "dist-tags", "--json"]).pipe(
				Effect.mapError(
					(error) =>
						new NpmRegistryError({
							pkg,
							operation: "view",
							reason: error.reason,
						}),
				),
				Effect.flatMap((output) => parseJson(pkg, "view", output.stdout)),
				Effect.map((data) => data as Record<string, string>),
			),

		getPackageInfo: (pkg: string, version?: string) => {
			const target = version ? `${pkg}@${version}` : pkg;
			return runner
				.execCapture("npm", [
					"view",
					target,
					"name",
					"version",
					"dist-tags",
					"dist.integrity",
					"dist.tarball",
					"--json",
				])
				.pipe(
					Effect.mapError(
						(error) =>
							new NpmRegistryError({
								pkg,
								operation: "view",
								reason: error.reason,
							}),
					),
					Effect.flatMap((output) => parseJson(pkg, "view", output.stdout)),
					Effect.map((data) => {
						const d = data as Record<string, unknown>;
						return {
							name: (d.name as string) ?? pkg,
							version: (d.version as string) ?? "0.0.0",
							distTags: (d["dist-tags"] as Record<string, string>) ?? {},
							integrity: (d["dist.integrity"] as string | undefined) ?? (d.dist as Record<string, string>)?.integrity,
							tarball: (d["dist.tarball"] as string | undefined) ?? (d.dist as Record<string, string>)?.tarball,
						};
					}),
				);
		},

		getVersions: (pkg: string) =>
			runner.execCapture("npm", ["view", pkg, "versions", "--json"]).pipe(
				Effect.mapError(
					(error) =>
						new NpmRegistryError({
							pkg,
							operation: "versions",
							reason: error.reason,
						}),
				),
				Effect.flatMap((output) => parseJson(pkg, "versions", output.stdout)),
				Effect.map((data) => {
					if (Array.isArray(data)) return data as string[];
					// Single version returns as a string, not array
					if (typeof data === "string") return [data];
					return [];
				}),
			),
	})),
);
