import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import { PackageManagerError } from "../errors/PackageManagerError.js";
import type { PackageManagerInfo, PackageManagerName } from "../schemas/PackageManager.js";
import { CommandRunner } from "../services/CommandRunner.js";
import type { InstallOptions } from "../services/PackageManagerAdapter.js";
import { PackageManagerAdapter } from "../services/PackageManagerAdapter.js";

const lockfileMap: ReadonlyArray<readonly [string, PackageManagerName]> = [
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
	["package-lock.json", "npm"],
	["bun.lockb", "bun"],
	["bun.lock", "bun"],
	["deno.lock", "deno"],
];

const lockfilePathsMap: Record<PackageManagerName, Array<string>> = {
	npm: ["package-lock.json"],
	pnpm: ["pnpm-lock.yaml"],
	yarn: ["yarn.lock"],
	bun: ["bun.lockb", "bun.lock"],
	deno: ["deno.lock"],
};

const getInstallArgs = (name: PackageManagerName, options: InstallOptions): ReadonlyArray<string> => {
	const frozen = options.frozen ?? true;
	switch (name) {
		case "npm":
			return frozen ? ["ci"] : ["install"];
		case "pnpm":
			return frozen ? ["install", "--frozen-lockfile"] : ["install"];
		case "yarn":
			return frozen ? ["install", "--immutable"] : ["install"];
		case "bun":
			return frozen ? ["install", "--frozen-lockfile"] : ["install"];
		case "deno":
			return ["install"];
	}
};

const parsePackageManagerField = (value: string): { name: PackageManagerName; version: string } | undefined => {
	const match = value.match(/^(npm|pnpm|yarn|bun|deno)@(.+)$/);
	if (!match) return undefined;
	return { name: match[1] as PackageManagerName, version: match[2] };
};

const getCachePathEffect = (
	runner: CommandRunner,
	name: PackageManagerName,
): Effect.Effect<Array<string>, PackageManagerError> => {
	if (name === "npm") {
		return runner.execCapture("npm", ["config", "get", "cache"]).pipe(
			Effect.map((output) => [output.stdout.trim()]),
			Effect.mapError(
				(error) =>
					new PackageManagerError({
						pm: name,
						operation: "cache",
						reason: `Failed to get cache paths: ${error.reason}`,
					}),
			),
		);
	}
	if (name === "pnpm") {
		return runner.execCapture("pnpm", ["store", "path"]).pipe(
			Effect.map((output) => [output.stdout.trim()]),
			Effect.mapError(
				(error) =>
					new PackageManagerError({
						pm: name,
						operation: "cache",
						reason: `Failed to get cache paths: ${error.reason}`,
					}),
			),
		);
	}
	if (name === "yarn") {
		return runner.execCapture("yarn", ["cache", "dir"]).pipe(
			Effect.map((output) => [output.stdout.trim()]),
			Effect.mapError(
				(error) =>
					new PackageManagerError({
						pm: name,
						operation: "cache",
						reason: `Failed to get cache paths: ${error.reason}`,
					}),
			),
		);
	}
	if (name === "bun") {
		return Effect.succeed([`${process.env.HOME ?? "~"}/.bun/install/cache`]);
	}
	return Effect.succeed([process.env.DENO_DIR ?? `${process.env.HOME ?? "~"}/.cache/deno`]);
};

/**
 * Live implementation of PackageManagerAdapter.
 *
 * Depends on CommandRunner for executing commands and FileSystem for reading
 * package.json and checking lockfiles.
 *
 * @public
 */
export const PackageManagerAdapterLive: Layer.Layer<
	PackageManagerAdapter,
	never,
	CommandRunner | FileSystem.FileSystem
> = Layer.effect(
	PackageManagerAdapter,
	Effect.all([CommandRunner, FileSystem.FileSystem] as const).pipe(
		Effect.map(([runner, fs]) => {
			const getVersion = (name: PackageManagerName): Effect.Effect<string, PackageManagerError> =>
				runner.execCapture(name, ["--version"]).pipe(
					Effect.map((output) => output.stdout.trim()),
					Effect.mapError(
						(error) =>
							new PackageManagerError({
								pm: name,
								operation: "detect",
								reason: `Failed to get ${name} version: ${error.reason}`,
							}),
					),
				);

			const detectFromPackageJson = (): Effect.Effect<
				{ name: PackageManagerName; version: string } | undefined,
				PackageManagerError
			> =>
				fs.readFileString("package.json").pipe(
					Effect.flatMap((content) =>
						Effect.try({
							try: () => JSON.parse(content) as Record<string, unknown>,
							catch: () =>
								new PackageManagerError({
									pm: undefined,
									operation: "detect",
									reason: "Failed to parse package.json",
								}),
						}),
					),
					Effect.map((pkg) => {
						const field = pkg.packageManager;
						if (typeof field !== "string") return undefined;
						return parsePackageManagerField(field);
					}),
					Effect.catchAll(() => Effect.succeed(undefined)),
				);

			const detectFromLockfile = (): Effect.Effect<
				{ name: PackageManagerName; lockfile: string } | undefined,
				PackageManagerError
			> => {
				const checks = lockfileMap.map(([file, name]) =>
					fs.access(file).pipe(
						Effect.map(() => ({ name, lockfile: file })),
						Effect.catchAll(() => Effect.succeed(undefined)),
					),
				);
				return Effect.all(checks).pipe(Effect.map((results) => results.find((r) => r !== undefined)));
			};

			const detect = (): Effect.Effect<PackageManagerInfo, PackageManagerError> =>
				detectFromPackageJson().pipe(
					Effect.flatMap((fromPkg) => {
						if (fromPkg) {
							return detectFromLockfile().pipe(
								Effect.map((fromLock) => ({
									name: fromPkg.name,
									version: fromPkg.version,
									lockfile: fromLock?.lockfile,
								})),
							);
						}
						return detectFromLockfile().pipe(
							Effect.flatMap((fromLock) => {
								if (!fromLock) {
									return Effect.fail(
										new PackageManagerError({
											pm: undefined,
											operation: "detect",
											reason: "No packageManager field in package.json and no lockfile found",
										}),
									);
								}
								return getVersion(fromLock.name).pipe(
									Effect.map((version) => ({
										name: fromLock.name,
										version,
										lockfile: fromLock.lockfile,
									})),
								);
							}),
						);
					}),
					Effect.withSpan("PackageManagerAdapter.detect"),
				);

			const install = (options?: InstallOptions): Effect.Effect<void, PackageManagerError> =>
				detect().pipe(
					Effect.flatMap((info) => {
						const args = getInstallArgs(info.name, options ?? {});
						const execOptions = options?.cwd ? { cwd: options.cwd } : undefined;
						return runner.exec(info.name, args, execOptions).pipe(
							Effect.mapError(
								(error) =>
									new PackageManagerError({
										pm: info.name,
										operation: "install",
										reason: `Install failed: ${error.reason}`,
									}),
							),
						);
					}),
					Effect.asVoid,
					Effect.withSpan("PackageManagerAdapter.install"),
				);

			const getCachePaths = (): Effect.Effect<Array<string>, PackageManagerError> =>
				detect().pipe(
					Effect.flatMap((info) => getCachePathEffect(runner, info.name)),
					Effect.withSpan("PackageManagerAdapter.getCachePaths"),
				);

			const getLockfilePaths = (): Effect.Effect<Array<string>, PackageManagerError> =>
				detect().pipe(
					Effect.map((info) => lockfilePathsMap[info.name]),
					Effect.withSpan("PackageManagerAdapter.getLockfilePaths"),
				);

			const exec: PackageManagerAdapter["exec"] = (args, options) =>
				detect().pipe(
					Effect.flatMap((info) =>
						runner.execCapture(info.name, args, options).pipe(
							Effect.mapError(
								(error) =>
									new PackageManagerError({
										pm: info.name,
										operation: "exec",
										reason: `Exec failed: ${error.reason}`,
									}),
							),
						),
					),
					Effect.withSpan("PackageManagerAdapter.exec", {
						attributes: { args: args.join(" ") },
					}),
				);

			return { detect, install, getCachePaths, getLockfilePaths, exec };
		}),
	),
);
