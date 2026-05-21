import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Redacted } from "effect";
import { PackagePublishError } from "../errors/PackagePublishError.js";
import { ActionOutputs } from "../services/ActionOutputs.js";
import { CommandRunner } from "../services/CommandRunner.js";
import { NpmRegistry } from "../services/NpmRegistry.js";
import type { DryRunResult, IdempotentPublishInput, PackResult } from "../services/PackagePublish.js";
import { PackagePublish } from "../services/PackagePublish.js";

/**
 * The size-bearing fields of npm's `--json` dry-run output.
 *
 * `npm publish --dry-run --json` emits one such object;
 * `npm pack --dry-run --json` emits an array of them. Only the fields
 * consumed by {@link DryRunResult} are modelled.
 */
interface PackedJson {
	readonly size?: number;
	readonly unpackedSize?: number;
	readonly entryCount?: number;
}

/**
 * Shape of an entry in `npm pack --json` output.
 *
 * @remarks
 * `npm pack --json` emits an array of objects, one per packed tarball.
 * Each object carries the fields modelled below; `integrity` is in the
 * `sha512-<base64>` shape the registry stores as `dist.integrity`.
 *
 * @internal
 */
interface NpmPackJsonEntry {
	readonly filename: string;
	readonly name?: string;
	readonly version?: string;
	readonly integrity?: string;
	readonly size?: number;
	readonly unpackedSize?: number;
	readonly entryCount?: number;
}

/**
 * Build npm's `_authToken` config key for a registry.
 *
 * npm derives a registry's auth-config key by stripping the URL scheme and
 * keeping a leading `//` — e.g. `https://npm.pkg.github.com/` becomes
 * `//npm.pkg.github.com/:_authToken`. The `registry` argument may be a full
 * URL or a bare host; both normalize to the same key. Writing the key with the
 * scheme still attached (`//https://…`) produces a key npm never matches, so
 * the publish is treated as unauthenticated.
 */
const authTokenKey = (registry: string): string => {
	const withoutScheme = registry.replace(/^https?:\/\//, "");
	const prefixed = withoutScheme.startsWith("//") ? withoutScheme : `//${withoutScheme}`;
	return `${prefixed}:_authToken`;
};

/**
 * Resolve the user-level `.npmrc` path that `npm config set` and `npm publish`
 * read. Honors `NPM_CONFIG_USERCONFIG` (the override `npm` itself respects),
 * falling back to `~/.npmrc`.
 *
 * @internal
 */
const userNpmrcPath = (): string => process.env.NPM_CONFIG_USERCONFIG ?? join(homedir(), ".npmrc");

/**
 * Write a registry auth-token line to the user `.npmrc` WITHOUT passing the
 * token as a command argument.
 *
 * @remarks
 * The previous implementation ran `npm config set <key> <token>`, which placed
 * the token in `args`; on failure `CommandRunnerError.message` rendered the
 * args and leaked the token. Writing the `_authToken=<token>` line directly to
 * the same `.npmrc` `npm config set` would have written (the userconfig) keeps
 * the wire bytes identical while removing the secret from any argv/error.
 * Unwrap the `Redacted` token only here, at the file-write boundary.
 *
 * @internal
 */
const writeAuthToken = (registry: string, token: Redacted.Redacted<string>): Effect.Effect<void, PackagePublishError> =>
	Effect.try({
		try: () => {
			appendFileSync(userNpmrcPath(), `${authTokenKey(registry)}=${Redacted.value(token)}\n`);
		},
		catch: (error) =>
			new PackagePublishError({
				operation: "setupAuth",
				registry,
				reason: error instanceof Error ? error.message : String(error),
				cause: error,
			}),
	});

/**
 * Resolve the command + base args used to invoke `npm` under each supported
 * package manager.
 *
 * @remarks
 * Critically, `pnpm dlx npm`, `yarn npm`, and `bun x npm` each fetch a fresh
 * `npm` rather than using the one bundled with the runner's Node. The runner's
 * bundled `npm` lags Node by several minor versions — Node 24 ships npm 10.x,
 * which has no support for npm trusted publishing (the OIDC token-exchange
 * step that lets `npm publish --provenance` run without an `NPM_TOKEN`).
 * Routing through the package manager's executor fetches npm 11.5.1+, which
 * supports the exchange. `"npm"` keeps the bundled `npm` and is the safe
 * default for callers that have ensured an adequate version themselves.
 *
 * @internal
 */
const getNpmCommand = (pm?: "npm" | "pnpm" | "yarn" | "bun"): { cmd: string; baseArgs: ReadonlyArray<string> } => {
	switch (pm) {
		case "pnpm":
			return { cmd: "pnpm", baseArgs: ["dlx", "npm"] };
		case "yarn":
			return { cmd: "yarn", baseArgs: ["npm"] };
		case "bun":
			return { cmd: "bun", baseArgs: ["x", "npm"] };
		default:
			return { cmd: "npm", baseArgs: [] };
	}
};

/**
 * Live PackagePublish layer using CommandRunner and NpmRegistry.
 *
 * @public
 */
export const PackagePublishLive: Layer.Layer<PackagePublish, never, CommandRunner | NpmRegistry | ActionOutputs> =
	Layer.effect(
		PackagePublish,
		Effect.all([CommandRunner, NpmRegistry, ActionOutputs]).pipe(
			Effect.map(([runner, registry, outputs]) => {
				const service: typeof PackagePublish.Service = {
					setupAuth: (registryUrl: string, token: Redacted.Redacted<string>) =>
						// Mask the token in the runner log first, then write it to
						// `.npmrc` off-argv (never as a command argument).
						outputs.setSecret(Redacted.value(token)).pipe(Effect.flatMap(() => writeAuthToken(registryUrl, token))),

					pack: (packageDir: string) =>
						Effect.gen(function* () {
							yield* Effect.logInfo(`pack: ${packageDir} start`);
							const output = yield* runner.execCapture("npm", ["pack", "--json"], { cwd: packageDir }).pipe(
								Effect.mapError(
									(error) =>
										new PackagePublishError({
											operation: "pack",
											reason: error.reason,
											cause: error,
										}),
								),
							);
							const entries = yield* Effect.try({
								try: () => JSON.parse(output.stdout) as ReadonlyArray<NpmPackJsonEntry>,
								catch: (error) =>
									new PackagePublishError({
										operation: "pack",
										reason: `Failed to parse npm pack JSON output: ${output.stdout.slice(0, 200)}`,
										cause: error,
									}),
							});
							const first = entries[0];
							if (!first) {
								return yield* Effect.fail(
									new PackagePublishError({
										operation: "pack",
										reason: "npm pack returned empty result",
									}),
								);
							}
							if (typeof first.integrity !== "string" || first.integrity === "") {
								return yield* Effect.fail(
									new PackagePublishError({
										operation: "pack",
										reason: "npm pack output missing integrity field",
									}),
								);
							}
							// Compute sha256-hex of the tarball alongside npm's sha512-base64
							// integrity. The two are used for different downstream APIs:
							// `digest` (sha512-base64) compares against `dist.integrity` from
							// the registry (the recovery decision); `sha256Hex` is the format
							// GitHub's artifact-metadata and attestation APIs accept as the
							// subject digest. The two are NOT interchangeable — different
							// algorithm, different encoding.
							const tarballPath = join(packageDir, first.filename);
							const sha256Hex = yield* Effect.try({
								try: () => createHash("sha256").update(readFileSync(tarballPath)).digest("hex"),
								catch: (error) =>
									new PackagePublishError({
										operation: "pack",
										reason: `Failed to compute sha256 of tarball at ${tarballPath}`,
										cause: error,
									}),
							});
							const result: PackResult = {
								tarballPath,
								digest: first.integrity,
								sha256Hex,
								name: typeof first.name === "string" ? first.name : "",
								version: typeof first.version === "string" ? first.version : "",
								packedSize: typeof first.size === "number" ? first.size : 0,
								unpackedSize: typeof first.unpackedSize === "number" ? first.unpackedSize : 0,
								fileCount: typeof first.entryCount === "number" ? first.entryCount : 0,
							};
							yield* Effect.logInfo(
								`pack: ${result.name}@${result.version} packed; tarball=${result.tarballPath}; digest=${result.digest}; sha256=${result.sha256Hex}; packedSize=${result.packedSize}; files=${result.fileCount}`,
							);
							return result;
						}),

					publish: (
						packageDir: string,
						options?: {
							readonly registry?: string;
							readonly tag?: string;
							readonly access?: "public" | "restricted";
							readonly provenance?: boolean;
							readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun";
						},
					) => {
						const { cmd, baseArgs } = getNpmCommand(options?.packageManager);
						const args = [...baseArgs, "publish"];
						if (options?.registry) args.push("--registry", options.registry);
						if (options?.tag) args.push("--tag", options.tag);
						if (options?.access) args.push("--access", options.access);
						if (options?.provenance) args.push("--provenance");
						// `--loglevel verbose` makes npm log its HTTP requests,
						// including the OIDC trusted-publisher exchange against
						// `<registry>/-/npm/v1/oidc/token/exchange` and the upstream
						// PUT. Without this the exchange step is invisible — npm
						// silently falls back to anonymous auth on exchange failure
						// and the registry returns a 404 that reads like "package
						// not found" but is actually "publisher not authorized."
						// Verbose only affects publish (not validation/dry-run);
						// safe to enable unconditionally.
						args.push("--loglevel", "verbose");

						// `streaming: true` tees npm's stdout and stderr to the
						// host process's stdout/stderr so the GitHub Actions runner
						// log captures the full output live. The captured strings
						// still flow into the error (when one occurs) — streaming
						// is additive. Without this, npm's output reached the
						// runner log only via the truncated error.message, hiding
						// the actual cause of a publish failure.
						return runner.exec(cmd, args, { cwd: packageDir, streaming: true }).pipe(
							Effect.asVoid,
							Effect.mapError(
								(error) =>
									new PackagePublishError({
										operation: "publish",
										...(options?.registry !== undefined ? { registry: options.registry } : {}),
										reason: error.reason,
										cause: error,
									}),
							),
						);
					},

					publishTarball: (
						tarballPath: string,
						options: {
							readonly registry: string;
							readonly access?: "public" | "restricted";
							readonly provenance?: boolean;
							readonly tag?: string;
							readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun";
						},
					) =>
						Effect.gen(function* () {
							yield* Effect.logInfo(
								`publishTarball: ${tarballPath} → ${options.registry} (access=${options.access ?? "default"}, provenance=${options.provenance === true})`,
							);
							const { cmd, baseArgs } = getNpmCommand(options.packageManager);
							const args = [...baseArgs, "publish", tarballPath, "--registry", options.registry];
							if (options.access) args.push("--access", options.access);
							if (options.provenance) args.push("--provenance");
							if (options.tag) args.push("--tag", options.tag);
							// See `publish` above for why verbose + streaming.
							// `cwd` is intentionally absent — the tarball path is
							// absolute, so npm resolves it without help.
							args.push("--loglevel", "verbose");
							yield* runner.exec(cmd, args, { streaming: true }).pipe(
								Effect.asVoid,
								Effect.mapError(
									(error) =>
										new PackagePublishError({
											operation: "publishTarball",
											registry: options.registry,
											reason: error.reason,
											cause: error,
										}),
								),
							);
							yield* Effect.logInfo(`publishTarball: ${tarballPath} → ${options.registry} success`);
						}),

					verifyIntegrity: (packageName: string, version: string, expectedDigest: string) =>
						registry.getPackageInfo(packageName, version).pipe(
							Effect.map((info) => info.integrity === expectedDigest),
							Effect.mapError(
								(error) =>
									new PackagePublishError({
										operation: "verifyIntegrity",
										pkg: packageName,
										reason: error.reason,
										cause: error,
									}),
							),
						),

					publishToRegistries: (
						packageDir: string,
						registries: Array<{
							readonly registry: string;
							readonly token: Redacted.Redacted<string>;
							readonly tag?: string;
							readonly access?: "public" | "restricted";
							readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun";
						}>,
					) =>
						Effect.forEach(
							registries,
							(target) =>
								// Mask + write the auth token to `.npmrc` off-argv; the
								// bundled npm reads `.npmrc` regardless of which manager
								// runs the publish.
								outputs
									.setSecret(Redacted.value(target.token))
									.pipe(Effect.flatMap(() => writeAuthToken(target.registry, target.token)))
									.pipe(
										Effect.flatMap(() => {
											// Route the publish through the active manager's npm
											// executor — same dispatch as `publish` / `publishTarball`
											// so a caller publishing through `publishToRegistries`
											// still gets the fresh-npm OIDC fix.
											const { cmd, baseArgs } = getNpmCommand(target.packageManager);
											const args = [...baseArgs, "publish"];
											args.push("--registry", target.registry);
											if (target.tag) args.push("--tag", target.tag);
											if (target.access) args.push("--access", target.access);
											args.push("--loglevel", "verbose");
											// See the `publish` method above — stream npm output
											// to the runner log so failures are diagnosable, and
											// verbose surfaces npm's OIDC exchange and HTTP requests.
											return runner.exec(cmd, args, { cwd: packageDir, streaming: true }).pipe(Effect.asVoid);
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
										cause: error,
									}),
							),
						),

					dryRun: (
						packageDir: string,
						options?: {
							readonly registry?: string;
							readonly tag?: string;
							readonly access?: "public" | "restricted";
							readonly provenance?: boolean;
						},
					) => {
						const args = ["publish", "--dry-run", "--json"];
						if (options?.registry) args.push("--registry", options.registry);
						if (options?.tag) args.push("--tag", options.tag);
						if (options?.access) args.push("--access", options.access);
						if (options?.provenance) args.push("--provenance");

						return runner.execCapture("npm", args, { cwd: packageDir }).pipe(
							Effect.flatMap((output) =>
								Effect.try({
									try: () => {
										// `npm publish --dry-run --json` emits a single JSON object.
										// `npm pack --dry-run --json` emits an array of such objects.
										// Tolerate both so this parser is robust to either form.
										const parsed = JSON.parse(output.stdout) as PackedJson | ReadonlyArray<PackedJson>;
										const first: PackedJson | undefined = Array.isArray(parsed) ? parsed[0] : parsed;
										const result: DryRunResult = {
											ok: true,
											output: output.stdout,
											...(first?.size !== undefined ? { packedSize: first.size } : {}),
											...(first?.unpackedSize !== undefined ? { unpackedSize: first.unpackedSize } : {}),
											...(first?.entryCount !== undefined ? { fileCount: first.entryCount } : {}),
										};
										return result;
									},
									catch: (error) =>
										new PackagePublishError({
											operation: "dryRun",
											reason: `Failed to parse npm publish --dry-run --json output: ${output.stdout.slice(0, 200)}`,
											cause: error,
										}),
								}),
							),
							Effect.catchTag(
								"CommandRunnerError",
								(error): Effect.Effect<DryRunResult, PackagePublishError> =>
									Effect.succeed({ ok: false, output: error.stderr ?? error.reason }),
							),
						);
					},

					publishIdempotent: (input: IdempotentPublishInput) =>
						Effect.gen(function* () {
							const versions = yield* registry.getVersions(input.packageName).pipe(
								Effect.mapError(
									(error) =>
										new PackagePublishError({
											operation: "publishIdempotent",
											pkg: input.packageName,
											reason: error.reason,
											cause: error,
										}),
								),
							);
							if (versions.includes(input.version)) {
								const identical = yield* service.verifyIntegrity(input.packageName, input.version, input.digest).pipe(
									Effect.mapError(
										(error) =>
											new PackagePublishError({
												operation: "publishIdempotent",
												pkg: input.packageName,
												reason: error.reason,
												cause: error,
											}),
									),
								);
								if (identical) {
									return {
										status: "skipped" as const,
										packageName: input.packageName,
										version: input.version,
										skipReason: "already-published-identical" as const,
									};
								}
								return yield* Effect.fail(
									new PackagePublishError({
										operation: "publishIdempotent",
										pkg: input.packageName,
										reason: `Published ${input.packageName}@${input.version} has a different integrity hash than the local build; refusing to republish.`,
									}),
								);
							}
							yield* service.publish(input.packageDir, input.options);
							return {
								status: "published" as const,
								packageName: input.packageName,
								version: input.version,
							};
						}),
				};
				return service;
			}),
		),
	);
