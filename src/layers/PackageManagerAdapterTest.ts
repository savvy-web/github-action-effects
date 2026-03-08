import { Effect, Layer } from "effect";
import type { PackageManagerInfo } from "../schemas/PackageManager.js";
import type { ExecOptions, ExecOutput } from "../services/CommandRunner.js";
import type { PackageManagerAdapter } from "../services/PackageManagerAdapter.js";
import { PackageManagerAdapter as PackageManagerAdapterTag } from "../services/PackageManagerAdapter.js";

/**
 * Test state for PackageManagerAdapter.
 *
 * @public
 */
export interface PackageManagerAdapterTestState {
	/** The package manager info to return from detect. */
	readonly info: PackageManagerInfo;
	/** Recorded exec calls. */
	readonly execCalls: Array<{ args: Array<string>; options: ExecOptions | undefined }>;
	/** Cache paths to return. */
	readonly cachePaths: Array<string>;
}

const lockfilePathsMap: Record<string, Array<string>> = {
	npm: ["package-lock.json"],
	pnpm: ["pnpm-lock.yaml"],
	yarn: ["yarn.lock"],
	bun: ["bun.lockb", "bun.lock"],
	deno: ["deno.lock"],
};

const makeTestAdapter = (state: PackageManagerAdapterTestState): PackageManagerAdapter => ({
	detect: () => Effect.succeed(state.info),

	install: () => Effect.void,

	getCachePaths: () => Effect.succeed(state.cachePaths),

	getLockfilePaths: () => Effect.succeed(lockfilePathsMap[state.info.name] ?? []),

	exec: (args, options) => {
		state.execCalls.push({ args: [...args], options });
		const output: ExecOutput = { exitCode: 0, stdout: "", stderr: "" };
		return Effect.succeed(output);
	},
});

/**
 * Test implementation for PackageManagerAdapter.
 *
 * @public
 */
export const PackageManagerAdapterTest = {
	/** Create a test layer with pre-configured state. */
	layer: (state: PackageManagerAdapterTestState): Layer.Layer<PackageManagerAdapter> =>
		Layer.succeed(PackageManagerAdapterTag, makeTestAdapter(state)),

	/** Create a fresh test state with pnpm defaults. */
	empty: (): PackageManagerAdapterTestState => ({
		info: { name: "pnpm", version: "9.0.0", lockfile: "pnpm-lock.yaml" },
		execCalls: [],
		cachePaths: ["/mock/cache"],
	}),
} as const;
