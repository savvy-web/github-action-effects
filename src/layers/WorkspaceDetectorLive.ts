import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import { WorkspaceDetectorError } from "../errors/WorkspaceDetectorError.js";
import type { WorkspaceInfo, WorkspacePackage } from "../schemas/Workspace.js";
import { WorkspaceDetector } from "../services/WorkspaceDetector.js";

const importYaml = Effect.tryPromise({
	try: () => import("yaml"),
	catch: () =>
		new WorkspaceDetectorError({
			operation: "detect",
			reason: "yaml is not installed. Add it as a dependency to detect pnpm workspaces.",
		}),
});

const makeInfo = (type: WorkspaceInfo["type"], patterns: string[]): WorkspaceInfo => ({
	root: ".",
	type,
	patterns,
});

/**
 * Live WorkspaceDetector layer using \@effect/platform FileSystem.
 *
 * @public
 */
export const WorkspaceDetectorLive: Layer.Layer<WorkspaceDetector, never, FileSystem.FileSystem> = Layer.effect(
	WorkspaceDetector,
	Effect.map(FileSystem.FileSystem, (fs) => {
		const fileExists = (path: string) =>
			fs.access(path).pipe(
				Effect.map(() => true),
				Effect.catchAll(() => Effect.succeed(false)),
			);

		const readFileString = (path: string) =>
			fs.readFileString(path).pipe(
				Effect.mapError(
					(error) =>
						new WorkspaceDetectorError({
							operation: "detect",
							reason: `Failed to read ${path}: ${error.message}`,
						}),
				),
			);

		const detect = (): Effect.Effect<WorkspaceInfo, WorkspaceDetectorError> =>
			fileExists("pnpm-workspace.yaml").pipe(
				Effect.flatMap((hasPnpmWorkspace): Effect.Effect<WorkspaceInfo, WorkspaceDetectorError> => {
					if (hasPnpmWorkspace) {
						return Effect.all([readFileString("pnpm-workspace.yaml"), importYaml] as const).pipe(
							Effect.flatMap(([content, yamlMod]) =>
								Effect.try({
									try: () => {
										const parsed = yamlMod.parse(content) as { packages?: string[] };
										return makeInfo("pnpm", parsed.packages ?? ["packages/*"]);
									},
									catch: (error) =>
										new WorkspaceDetectorError({
											operation: "detect",
											reason: `Failed to parse pnpm-workspace.yaml: ${error instanceof Error ? error.message : String(error)}`,
										}),
								}),
							),
						);
					}

					return fileExists("package.json").pipe(
						Effect.flatMap((hasPkgJson): Effect.Effect<WorkspaceInfo, WorkspaceDetectorError> => {
							if (!hasPkgJson) {
								return Effect.succeed(makeInfo("single", ["."]));
							}

							return readFileString("package.json").pipe(
								Effect.flatMap((content) =>
									Effect.try({
										try: () => JSON.parse(content) as Record<string, unknown>,
										catch: (error) =>
											new WorkspaceDetectorError({
												operation: "detect",
												reason: `Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`,
											}),
									}),
								),
								Effect.flatMap((pkg): Effect.Effect<WorkspaceInfo, never> => {
									const workspaces = pkg.workspaces;
									let patterns: string[] | undefined;

									if (Array.isArray(workspaces)) {
										patterns = workspaces as string[];
									} else if (
										typeof workspaces === "object" &&
										workspaces !== null &&
										Array.isArray((workspaces as Record<string, unknown>).packages)
									) {
										patterns = (workspaces as { packages: string[] }).packages;
									}

									if (!patterns) {
										return Effect.succeed(makeInfo("single", ["."]));
									}

									const resolvedPatterns = patterns;
									// Determine type based on lockfile
									return Effect.all({
										hasYarnLock: fileExists("yarn.lock"),
										hasBunLock: fileExists("bun.lock").pipe(
											Effect.flatMap((has) => (has ? Effect.succeed(true) : fileExists("bun.lockb"))),
										),
									}).pipe(
										Effect.map(({ hasYarnLock, hasBunLock }) =>
											makeInfo(hasBunLock ? "bun" : hasYarnLock ? "yarn" : "npm", resolvedPatterns),
										),
									);
								}),
							);
						}),
					);
				}),
				Effect.withSpan("WorkspaceDetector.detect"),
			);

		const readPackageJson = (dir: string): Effect.Effect<WorkspacePackage, WorkspaceDetectorError> =>
			readFileString(`${dir}/package.json`).pipe(
				Effect.mapError(
					() =>
						new WorkspaceDetectorError({
							operation: "list",
							reason: `Failed to read package.json in ${dir}`,
						}),
				),
				Effect.flatMap((content) =>
					Effect.try({
						try: () => {
							const pkg = JSON.parse(content) as Record<string, unknown>;
							return {
								name: (pkg.name as string) ?? dir,
								version: (pkg.version as string) ?? "0.0.0",
								path: dir,
								private: (pkg.private as boolean) ?? false,
								dependencies: (pkg.dependencies as Record<string, string>) ?? {},
							};
						},
						catch: (error) =>
							new WorkspaceDetectorError({
								operation: "list",
								reason: `Failed to parse package.json in ${dir}: ${error instanceof Error ? error.message : String(error)}`,
							}),
					}),
				),
			);

		const listPackages = (): Effect.Effect<Array<WorkspacePackage>, WorkspaceDetectorError> =>
			detect().pipe(
				Effect.flatMap((info) => {
					if (info.type === "single") {
						return readPackageJson(".").pipe(Effect.map((pkg) => [pkg]));
					}

					// For each pattern, list directories matching the glob
					return Effect.forEach(info.patterns, (pattern) => {
						// Simple glob: pattern like "packages/*" -> read directory "packages" and list subdirs
						const parts = pattern.split("/");
						const baseDir = parts.slice(0, -1).join("/") || ".";

						return fs.readDirectory(baseDir).pipe(
							Effect.mapError(
								() =>
									new WorkspaceDetectorError({
										operation: "list",
										reason: `Failed to read directory: ${baseDir}`,
									}),
							),
							Effect.flatMap((entries) =>
								Effect.forEach(
									entries,
									(entry) => {
										const pkgDir = baseDir === "." ? entry : `${baseDir}/${entry}`;
										return fileExists(`${pkgDir}/package.json`).pipe(
											Effect.flatMap((hasPackageJson) =>
												hasPackageJson
													? readPackageJson(pkgDir).pipe(Effect.map((pkg) => [pkg]))
													: Effect.succeed([] as WorkspacePackage[]),
											),
										);
									},
									{ concurrency: "unbounded" },
								),
							),
							Effect.map((results) => results.flat()),
						);
					}).pipe(Effect.map((results) => results.flat()));
				}),
				Effect.withSpan("WorkspaceDetector.listPackages"),
			);

		const getPackage = (nameOrPath: string): Effect.Effect<WorkspacePackage, WorkspaceDetectorError> =>
			listPackages().pipe(
				Effect.flatMap((packages) => {
					const found = packages.find((p) => p.name === nameOrPath || p.path === nameOrPath);
					if (!found) {
						return Effect.fail(
							new WorkspaceDetectorError({
								operation: "get",
								reason: `Package "${nameOrPath}" not found`,
							}),
						);
					}
					return Effect.succeed(found);
				}),
				Effect.withSpan("WorkspaceDetector.getPackage", { attributes: { "workspace.nameOrPath": nameOrPath } }),
			);

		return { detect, listPackages, getPackage };
	}),
);
