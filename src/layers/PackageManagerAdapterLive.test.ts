import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { PackageManagerError } from "../errors/PackageManagerError.js";
import type { CommandResponse } from "../layers/CommandRunnerTest.js";
import { CommandRunnerTest } from "../layers/CommandRunnerTest.js";
import { PackageManagerAdapter } from "../services/PackageManagerAdapter.js";
import { PackageManagerAdapterLive } from "./PackageManagerAdapterLive.js";

// -- Mock FileSystem --

interface MockFileEntry {
	readonly content: string;
}

const makeMockFs = (files: Record<string, MockFileEntry>): FileSystem.FileSystem => {
	return {
		readFileString: (path: string) => {
			const entry = files[path];
			if (!entry) {
				return Effect.fail({ _tag: "SystemError", message: `File not found: ${path}` } as never);
			}
			return Effect.succeed(entry.content);
		},

		access: (path: string) => {
			if (!files[path]) {
				return Effect.fail({ _tag: "SystemError", message: `File not found: ${path}` } as never);
			}
			return Effect.void;
		},

		readDirectory: () => Effect.succeed([]),
		writeFileString: () => Effect.void,
		chmod: () => Effect.void,
		chown: () => Effect.void,
		copy: () => Effect.void,
		copyFile: () => Effect.void,
		exists: () => Effect.succeed(true),
		link: () => Effect.void,
		makeDirectory: () => Effect.void,
		makeTempDirectory: () => Effect.succeed("/tmp/test"),
		makeTempDirectoryScoped: () => Effect.succeed("/tmp/test"),
		makeTempFile: () => Effect.succeed("/tmp/test-file"),
		makeTempFileScoped: () => Effect.succeed("/tmp/test-file"),
		open: () => Effect.die("not implemented"),
		readFile: () => Effect.die("not implemented"),
		readLink: () => Effect.succeed("/tmp"),
		realPath: () => Effect.succeed("/tmp"),
		remove: () => Effect.void,
		rename: () => Effect.void,
		sink: () => Effect.die("not implemented") as never,
		stat: () => Effect.die("not implemented"),
		stream: () => Effect.die("not implemented") as never,
		symlink: () => Effect.void,
		truncate: () => Effect.void,
		utimes: () => Effect.void,
		watch: () => Effect.die("not implemented") as never,
		writeFile: () => Effect.void,
	} as unknown as FileSystem.FileSystem;
};

const makeTestLayer = (files: Record<string, MockFileEntry>, responses: ReadonlyMap<string, CommandResponse>) =>
	Layer.provide(
		PackageManagerAdapterLive,
		Layer.mergeAll(CommandRunnerTest.layer(responses), Layer.succeed(FileSystem.FileSystem, makeMockFs(files))),
	);

const run = <A, E>(
	files: Record<string, MockFileEntry>,
	responses: ReadonlyMap<string, CommandResponse>,
	effect: Effect.Effect<A, E, PackageManagerAdapter>,
) => Effect.runPromise(Effect.provide(effect, makeTestLayer(files, responses)));

const runFail = (
	files: Record<string, MockFileEntry>,
	responses: ReadonlyMap<string, CommandResponse>,
	effect: Effect.Effect<unknown, PackageManagerError, PackageManagerAdapter>,
) => Effect.runPromise(Effect.flip(Effect.provide(effect, makeTestLayer(files, responses))));

describe("PackageManagerAdapterLive", () => {
	describe("detect", () => {
		it("detects from packageManager field in package.json", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ name: "test", packageManager: "pnpm@9.1.0" }) },
			};

			const result = await run(
				files,
				new Map(),
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.detect()),
			);
			expect(result.name).toBe("pnpm");
			expect(result.version).toBe("9.1.0");
		});

		it("detects from lockfile scanning", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ name: "test" }) },
				"yarn.lock": { content: "" },
			};
			const responses = new Map<string, CommandResponse>([
				["yarn --version", { exitCode: 0, stdout: "4.0.0\n", stderr: "" }],
			]);

			const result = await run(
				files,
				responses,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.detect()),
			);
			expect(result.name).toBe("yarn");
			expect(result.version).toBe("4.0.0");
			expect(result.lockfile).toBe("yarn.lock");
		});

		it("fails when no packageManager field and no lockfile", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ name: "test" }) },
			};

			const error = await runFail(
				files,
				new Map(),
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.detect()),
			);
			expect(error.operation).toBe("detect");
			expect(error.reason).toContain("no lockfile found");
		});

		it("detects npm from package-lock.json", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ name: "test" }) },
				"package-lock.json": { content: "" },
			};
			const responses = new Map<string, CommandResponse>([
				["npm --version", { exitCode: 0, stdout: "10.2.0\n", stderr: "" }],
			]);

			const result = await run(
				files,
				responses,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.detect()),
			);
			expect(result.name).toBe("npm");
			expect(result.version).toBe("10.2.0");
		});
	});

	describe("install", () => {
		it("runs correct command for detected PM (pnpm, frozen)", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ packageManager: "pnpm@9.0.0" }) },
			};
			const responses = new Map<string, CommandResponse>([
				["pnpm install --frozen-lockfile", { exitCode: 0, stdout: "", stderr: "" }],
			]);

			await run(
				files,
				responses,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.install()),
			);
		});

		it("runs npm ci for npm with frozen lockfile", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ packageManager: "npm@10.0.0" }) },
			};
			const responses = new Map<string, CommandResponse>([["npm ci", { exitCode: 0, stdout: "", stderr: "" }]]);

			await run(
				files,
				responses,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.install({ frozen: true })),
			);
		});

		it("runs npm install when frozen is false", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ packageManager: "npm@10.0.0" }) },
			};
			const responses = new Map<string, CommandResponse>([["npm install", { exitCode: 0, stdout: "", stderr: "" }]]);

			await run(
				files,
				responses,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.install({ frozen: false })),
			);
		});
	});

	describe("getCachePaths", () => {
		it("queries correct command for npm", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ packageManager: "npm@10.0.0" }) },
			};
			const responses = new Map<string, CommandResponse>([
				["npm config get cache", { exitCode: 0, stdout: "/home/user/.npm\n", stderr: "" }],
			]);

			const result = await run(
				files,
				responses,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.getCachePaths()),
			);
			expect(result).toEqual(["/home/user/.npm"]);
		});

		it("queries correct command for pnpm", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ packageManager: "pnpm@9.0.0" }) },
			};
			const responses = new Map<string, CommandResponse>([
				["pnpm store path", { exitCode: 0, stdout: "/home/user/.local/share/pnpm/store\n", stderr: "" }],
			]);

			const result = await run(
				files,
				responses,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.getCachePaths()),
			);
			expect(result).toEqual(["/home/user/.local/share/pnpm/store"]);
		});
	});

	describe("getLockfilePaths", () => {
		it("returns correct lockfiles for detected PM", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ packageManager: "yarn@4.0.0" }) },
			};

			const result = await run(
				files,
				new Map(),
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.getLockfilePaths()),
			);
			expect(result).toEqual(["yarn.lock"]);
		});
	});

	describe("exec", () => {
		it("delegates to CommandRunner", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ packageManager: "pnpm@9.0.0" }) },
			};
			const responses = new Map<string, CommandResponse>([
				["pnpm run build", { exitCode: 0, stdout: "build output\n", stderr: "" }],
			]);

			const result = await run(
				files,
				responses,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.exec(["run", "build"])),
			);
			expect(result.stdout).toBe("build output\n");
			expect(result.exitCode).toBe(0);
		});

		it("maps errors to PackageManagerError", async () => {
			const files = {
				"package.json": { content: JSON.stringify({ packageManager: "pnpm@9.0.0" }) },
			};
			const responses = new Map<string, CommandResponse>([
				["pnpm run fail", { exitCode: 1, stdout: "", stderr: "error output" }],
			]);

			const error = await runFail(
				files,
				responses,
				Effect.flatMap(PackageManagerAdapter, (svc) => svc.exec(["run", "fail"])),
			);
			expect(error.operation).toBe("exec");
			expect(error.pm).toBe("pnpm");
		});
	});
});
