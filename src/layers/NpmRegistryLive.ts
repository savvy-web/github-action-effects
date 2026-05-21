import { Effect, Layer, Option } from "effect";
import type { CommandRunnerError } from "../errors/CommandRunnerError.js";
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
 * Append `--registry <url>` to an arg list when the option is supplied.
 *
 * @internal
 */
const withRegistry = (args: ReadonlyArray<string>, options?: { readonly registry?: string }): ReadonlyArray<string> =>
	options?.registry ? [...args, "--registry", options.registry] : args;

/**
 * Detect an `npm view` E404 — emitted when the queried name+version is not
 * published on the target registry. npm 11.x writes the marker line
 * `npm error code E404` to stderr; older versions used `npm ERR! code E404`.
 * Accept both for safety. We deliberately do not parse the JSON body for
 * 404 markers because npm omits the JSON entirely on E404.
 *
 * @internal
 */
const isE404 = (error: CommandRunnerError): boolean => {
	const stderr = error.stderr ?? "";
	return /(?:npm (?:error|ERR!)\s+code\s+E404)/.test(stderr);
};

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

		getPackageInfo: (pkg: string, version?: string, options?: { readonly registry?: string }) => {
			const target = version ? `${pkg}@${version}` : pkg;
			const args = withRegistry(
				["view", target, "name", "version", "dist-tags", "dist.integrity", "dist.tarball", "--json"],
				options,
			);
			return runner.execCapture("npm", args).pipe(
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

		getVersions: (pkg: string, options?: { readonly registry?: string }) => {
			const args = withRegistry(["view", pkg, "versions", "--json"], options);
			return runner.execCapture("npm", args).pipe(
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
			);
		},

		getPublishedIntegrity: (pkg: string, version: string, options: { readonly registry: string }) =>
			Effect.gen(function* () {
				yield* Effect.logInfo(`getPublishedIntegrity: ${pkg}@${version} at ${options.registry}`);
				const target = `${pkg}@${version}`;
				const args = ["view", target, "dist.integrity", "--json", "--registry", options.registry];
				// `npm view <name>@<missing-version> --json` exits non-zero with
				// `npm error code E404` and a body of `'<pkg>@<ver>' is not in
				// this registry`. Treat that exact signal as `Option.none()`.
				// Any other CommandRunnerError (network, auth, server 5xx)
				// propagates as an NpmRegistryError.
				const captured = yield* runner.execCapture("npm", args).pipe(
					Effect.map(Option.some),
					Effect.catchTag("CommandRunnerError", (error) =>
						isE404(error)
							? Effect.succeed(Option.none<{ exitCode: number; stdout: string; stderr: string }>())
							: Effect.fail(
									new NpmRegistryError({
										pkg,
										operation: "view",
										reason: error.reason,
									}),
								),
					),
				);
				if (Option.isNone(captured)) {
					yield* Effect.logInfo(`getPublishedIntegrity: ${pkg}@${version} at ${options.registry} → not published`);
					return Option.none<string>();
				}
				const output = captured.value;
				// npm exited cleanly. Empty stdout (or `{}`) means the registry
				// knows the name but the queried field is absent — treat as
				// not-published so first-publish-after-name-creation works.
				const trimmed = output.stdout.trim();
				if (trimmed === "" || trimmed === "{}") {
					yield* Effect.logInfo(`getPublishedIntegrity: ${pkg}@${version} at ${options.registry} → not published`);
					return Option.none<string>();
				}
				const parsed = yield* parseJson(pkg, "view", output.stdout);
				const data = parsed as Record<string, unknown> | string | null;
				let integrity: string | undefined;
				if (typeof data === "string") {
					// `npm view <pkg>@<ver> dist.integrity --json` flattens to a
					// JSON string when one field is requested. Treat the whole
					// string as the integrity value.
					integrity = data;
				} else if (data && typeof data === "object") {
					const obj = data as Record<string, unknown>;
					const flat = obj["dist.integrity"];
					const nested = (obj.dist as Record<string, unknown> | undefined)?.integrity;
					if (typeof flat === "string") integrity = flat;
					else if (typeof nested === "string") integrity = nested;
				}
				if (integrity === undefined) {
					yield* Effect.logInfo(`getPublishedIntegrity: ${pkg}@${version} at ${options.registry} → not published`);
					return Option.none<string>();
				}
				yield* Effect.logInfo(
					`getPublishedIntegrity: ${pkg}@${version} at ${options.registry} → present (integrity=${integrity})`,
				);
				return Option.some(integrity);
			}),
	})),
);
