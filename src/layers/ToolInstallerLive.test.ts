import type { Context } from "effect";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
	chmod: vi.fn().mockResolvedValue(undefined),
}));

import type { ToolInstallerError } from "../errors/ToolInstallerError.js";
import { ActionsCore } from "../services/ActionsCore.js";
import { ActionsToolCache } from "../services/ActionsToolCache.js";
import { ToolInstaller } from "../services/ToolInstaller.js";
import { ToolInstallerLive } from "./ToolInstallerLive.js";

// -- Mock factory for ActionsToolCache --

const mockToolCache = (overrides: Partial<Context.Tag.Service<typeof ActionsToolCache>> = {}) =>
	Layer.succeed(ActionsToolCache, {
		find: () => "",
		downloadTool: () => Promise.resolve(""),
		extractTar: () => Promise.resolve(""),
		extractZip: () => Promise.resolve(""),
		cacheDir: () => Promise.resolve(""),
		cacheFile: () => Promise.resolve(""),
		...overrides,
	});

// -- Mock factory for ActionsCore --

const mockCore = (overrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {}) =>
	Layer.succeed(ActionsCore, {
		getInput: () => "",
		getMultilineInput: () => [],
		getBooleanInput: () => false,
		setOutput: () => {},
		setFailed: () => {},
		exportVariable: () => {},
		addPath: () => {},
		setSecret: () => {},
		info: () => {},
		debug: () => {},
		warning: () => {},
		error: () => {},
		notice: () => {},
		startGroup: () => {},
		endGroup: () => {},
		getState: () => "",
		saveState: () => {},
		summary: { write: () => Promise.resolve(), addRaw: () => ({ write: () => Promise.resolve() }) },
		...overrides,
	});

const run = <A, E>(
	effect: Effect.Effect<A, E, ToolInstaller>,
	tcOverrides: Partial<Context.Tag.Service<typeof ActionsToolCache>> = {},
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) =>
	Effect.runPromise(
		Effect.provide(
			effect,
			ToolInstallerLive.pipe(Layer.provide(Layer.merge(mockToolCache(tcOverrides), mockCore(coreOverrides)))),
		),
	);

const runFail = <A>(
	effect: Effect.Effect<A, ToolInstallerError, ToolInstaller>,
	tcOverrides: Partial<Context.Tag.Service<typeof ActionsToolCache>> = {},
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) =>
	Effect.runPromise(
		Effect.flip(
			Effect.provide(
				effect,
				ToolInstallerLive.pipe(Layer.provide(Layer.merge(mockToolCache(tcOverrides), mockCore(coreOverrides)))),
			),
		),
	);

describe("ToolInstallerLive", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("install", () => {
		it("returns cached path when tool is already cached", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
				{ find },
			);

			expect(result).toBe("/cached/node/20.0.0");
			expect(find).toHaveBeenCalledWith("node", "20.0.0");
		});

		it("downloads, extracts tar.gz, and caches when not cached", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
				{ find, downloadTool, extractTar, cacheDir },
			);

			expect(result).toBe("/cached/node/20.0.0");
			expect(downloadTool).toHaveBeenCalledWith("https://example.com/node.tar.gz");
			expect(extractTar).toHaveBeenCalledWith("/tmp/download");
			expect(cacheDir).toHaveBeenCalledWith("/tmp/extracted", "node", "20.0.0");
		});

		it("extracts tar.xz with xJ flags", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/tool/1.0.0");

			await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("tool", "1.0.0", "https://example.com/tool.tar.xz", { archiveType: "tar.xz" }),
				),
				{ find, downloadTool, extractTar, cacheDir },
			);

			expect(extractTar).toHaveBeenCalledWith("/tmp/download", undefined, "xJ");
		});

		it("extracts zip archives", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractZip = vi.fn<(path: string) => Promise<string>>().mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/tool/1.0.0");

			await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("tool", "1.0.0", "https://example.com/tool.zip", { archiveType: "zip" }),
				),
				{ find, downloadTool, extractZip, cacheDir },
			);

			expect(extractZip).toHaveBeenCalledWith("/tmp/download");
		});

		it("appends binSubPath to cached path", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("node", "20.0.0", "https://example.com/node.tar.gz", { binSubPath: "bin" }),
				),
				{ find, downloadTool, extractTar, cacheDir },
			);

			expect(result).toBe("/cached/node/20.0.0/bin");
		});

		it("appends binSubPath to already-cached path", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("node", "20.0.0", "https://example.com/node.tar.gz", { binSubPath: "bin" }),
				),
				{ find },
			);

			expect(result).toBe("/cached/node/20.0.0/bin");
		});

		it("fails with download error when download fails", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockRejectedValue(new Error("Network error"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
				{ find, downloadTool },
			);

			expect(error.operation).toBe("download");
			expect(error.tool).toBe("node");
			expect(error.version).toBe("20.0.0");
		});

		it("fails with extract error when extraction fails", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockRejectedValue(new Error("Corrupt archive"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
				{ find, downloadTool, extractTar },
			);

			expect(error.operation).toBe("extract");
		});

		it("fails with extract error when tar.xz extraction fails", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockRejectedValue(new Error("Corrupt xz archive"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("tool", "1.0.0", "https://example.com/tool.tar.xz", { archiveType: "tar.xz" }),
				),
				{ find, downloadTool, extractTar },
			);

			expect(error.operation).toBe("extract");
			expect(error.reason).toContain("tar.xz");
		});

		it("fails with extract error when zip extraction fails", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractZip = vi.fn<(path: string) => Promise<string>>().mockRejectedValue(new Error("Corrupt zip"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("tool", "1.0.0", "https://example.com/tool.zip", { archiveType: "zip" }),
				),
				{ find, downloadTool, extractZip },
			);

			expect(error.operation).toBe("extract");
			expect(error.reason).toContain("zip");
		});

		it("fails with cache error when caching fails", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockRejectedValue(new Error("Disk full"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
				{ find, downloadTool, extractTar, cacheDir },
			);

			expect(error.operation).toBe("cache");
		});
	});

	describe("isCached", () => {
		it("returns true when tool is cached", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) => svc.isCached("node", "20.0.0")),
				{ find },
			);

			expect(result).toBe(true);
		});

		it("returns false when tool is not cached", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) => svc.isCached("node", "20.0.0")),
				{ find },
			);

			expect(result).toBe(false);
		});

		it("returns false when find throws an error", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockImplementation(() => {
				throw new Error("tool-cache broken");
			});

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) => svc.isCached("node", "20.0.0")),
				{ find },
			);

			expect(result).toBe(false);
		});
	});

	describe("installAndAddToPath", () => {
		it("installs and adds to PATH", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/node/20.0.0");
			const addPath = vi.fn<(path: string) => void>();

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
				{ find, downloadTool, extractTar, cacheDir },
				{ addPath },
			);

			expect(result).toBe("/cached/node/20.0.0");
			expect(addPath).toHaveBeenCalledWith("/cached/node/20.0.0");
		});

		it("adds cached tool to PATH without downloading", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("/cached/node/20.0.0");
			const downloadTool = vi.fn<(url: string) => Promise<string>>();
			const addPath = vi.fn<(path: string) => void>();

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
				{ find, downloadTool },
				{ addPath },
			);

			expect(result).toBe("/cached/node/20.0.0");
			expect(downloadTool).not.toHaveBeenCalled();
			expect(addPath).toHaveBeenCalledWith("/cached/node/20.0.0");
		});

		it("appends binSubPath to cached path and adds to PATH", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("/cached/node/20.0.0");
			const downloadTool = vi.fn<(url: string) => Promise<string>>();
			const addPath = vi.fn<(path: string) => void>();

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz", { binSubPath: "bin" }),
				),
				{ find, downloadTool },
				{ addPath },
			);

			expect(result).toBe("/cached/node/20.0.0/bin");
			expect(downloadTool).not.toHaveBeenCalled();
			expect(addPath).toHaveBeenCalledWith("/cached/node/20.0.0/bin");
		});

		it("appends binSubPath to freshly installed path", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/node/20.0.0");
			const addPath = vi.fn<(path: string) => void>();

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz", { binSubPath: "bin" }),
				),
				{ find, downloadTool, extractTar, cacheDir },
				{ addPath },
			);

			expect(result).toBe("/cached/node/20.0.0/bin");
			expect(addPath).toHaveBeenCalledWith("/cached/node/20.0.0/bin");
		});

		it("extracts tar.xz with xJ flags", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/tool/1.0.0");
			const addPath = vi.fn<(path: string) => void>();

			await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("tool", "1.0.0", "https://example.com/tool.tar.xz", { archiveType: "tar.xz" }),
				),
				{ find, downloadTool, extractTar, cacheDir },
				{ addPath },
			);

			expect(extractTar).toHaveBeenCalledWith("/tmp/download", undefined, "xJ");
			expect(addPath).toHaveBeenCalledWith("/cached/tool/1.0.0");
		});

		it("extracts zip archives", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractZip = vi.fn<(path: string) => Promise<string>>().mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/tool/1.0.0");
			const addPath = vi.fn<(path: string) => void>();

			await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("tool", "1.0.0", "https://example.com/tool.zip", { archiveType: "zip" }),
				),
				{ find, downloadTool, extractZip, cacheDir },
				{ addPath },
			);

			expect(extractZip).toHaveBeenCalledWith("/tmp/download");
			expect(addPath).toHaveBeenCalledWith("/cached/tool/1.0.0");
		});

		it("fails with download error when download fails", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockRejectedValue(new Error("Network error"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
				{ find, downloadTool },
			);

			expect(error.operation).toBe("download");
			expect(error.tool).toBe("node");
		});

		it("fails with extract error when extraction fails", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockRejectedValue(new Error("Corrupt archive"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
				{ find, downloadTool, extractTar },
			);

			expect(error.operation).toBe("extract");
		});

		it("fails with cache error when caching fails", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockRejectedValue(new Error("Disk full"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
				{ find, downloadTool, extractTar, cacheDir },
			);

			expect(error.operation).toBe("cache");
		});

		it("fails with path error when addPath throws", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const extractTar = vi
				.fn<(path: string, dest?: string, flags?: string) => Promise<string>>()
				.mockResolvedValue("/tmp/extracted");
			const cacheDir = vi
				.fn<(dir: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/node/20.0.0");
			const addPath = vi.fn<(path: string) => void>().mockImplementation(() => {
				throw new Error("Cannot modify PATH");
			});

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
				{ find, downloadTool, extractTar, cacheDir },
				{ addPath },
			);

			expect(error.operation).toBe("path");
			expect(error.tool).toBe("node");
		});
	});

	describe("installBinary", () => {
		it("returns cached path when already cached", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("/cached/biome/1.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) => svc.installBinary("biome", "1.0.0", "https://example.com/biome")),
				{ find },
			);

			expect(result).toBe("/cached/biome/1.0.0");
			expect(find).toHaveBeenCalledWith("biome", "1.0.0");
		});

		it("downloads, caches file, and chmods on cache miss", async () => {
			const { chmod } = await import("node:fs/promises");
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const cacheFile = vi
				.fn<(sourceFile: string, targetFile: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/biome/1.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) => svc.installBinary("biome", "1.0.0", "https://example.com/biome")),
				{ find, downloadTool, cacheFile },
			);

			expect(result).toBe("/cached/biome/1.0.0");
			expect(downloadTool).toHaveBeenCalledWith("https://example.com/biome");
			expect(cacheFile).toHaveBeenCalledWith("/tmp/download", "biome", "biome", "1.0.0");
			expect(chmod).toHaveBeenCalledWith("/cached/biome/1.0.0/biome", 0o755);
		});

		it("uses custom binaryName when provided", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const cacheFile = vi
				.fn<(sourceFile: string, targetFile: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/biome/1.0.0");

			await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installBinary("biome", "1.0.0", "https://example.com/biome-linux", { binaryName: "biome" }),
				),
				{ find, downloadTool, cacheFile },
			);

			expect(cacheFile).toHaveBeenCalledWith("/tmp/download", "biome", "biome", "1.0.0");
		});

		it("skips chmod when executable is false", async () => {
			const { chmod } = await import("node:fs/promises");
			vi.mocked(chmod).mockClear();
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const cacheFile = vi
				.fn<(sourceFile: string, targetFile: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/biome/1.0.0");

			await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installBinary("biome", "1.0.0", "https://example.com/biome", { executable: false }),
				),
				{ find, downloadTool, cacheFile },
			);

			expect(chmod).not.toHaveBeenCalled();
		});

		it("fails with ToolInstallerError on download failure", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockRejectedValue(new Error("Network error"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) => svc.installBinary("biome", "1.0.0", "https://example.com/biome")),
				{ find, downloadTool },
			);

			expect(error.operation).toBe("download");
			expect(error.tool).toBe("biome");
		});

		it("fails with ToolInstallerError on cache failure", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const cacheFile = vi
				.fn<(sourceFile: string, targetFile: string, tool: string, version: string) => Promise<string>>()
				.mockRejectedValue(new Error("Disk full"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) => svc.installBinary("biome", "1.0.0", "https://example.com/biome")),
				{ find, downloadTool, cacheFile },
			);

			expect(error.operation).toBe("cache");
			expect(error.tool).toBe("biome");
		});
	});

	describe("installBinaryAndAddToPath", () => {
		it("downloads, caches, chmods, and adds to PATH on miss", async () => {
			const { chmod } = await import("node:fs/promises");
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const cacheFile = vi
				.fn<(sourceFile: string, targetFile: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/biome/1.0.0");
			const addPath = vi.fn<(path: string) => void>();

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installBinaryAndAddToPath("biome", "1.0.0", "https://example.com/biome"),
				),
				{ find, downloadTool, cacheFile },
				{ addPath },
			);

			expect(result).toBe("/cached/biome/1.0.0");
			expect(addPath).toHaveBeenCalledWith("/cached/biome/1.0.0");
			expect(chmod).toHaveBeenCalledWith("/cached/biome/1.0.0/biome", 0o755);
		});

		it("returns cached path and adds to PATH when cached", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("/cached/biome/1.0.0");
			const addPath = vi.fn<(path: string) => void>();

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installBinaryAndAddToPath("biome", "1.0.0", "https://example.com/biome"),
				),
				{ find },
				{ addPath },
			);

			expect(result).toBe("/cached/biome/1.0.0");
			expect(addPath).toHaveBeenCalledWith("/cached/biome/1.0.0");
		});

		it("skips chmod when executable is false", async () => {
			const { chmod } = await import("node:fs/promises");
			vi.mocked(chmod).mockClear();
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const cacheFile = vi
				.fn<(sourceFile: string, targetFile: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/biome/1.0.0");
			const addPath = vi.fn<(path: string) => void>();

			await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installBinaryAndAddToPath("biome", "1.0.0", "https://example.com/biome", { executable: false }),
				),
				{ find, downloadTool, cacheFile },
				{ addPath },
			);

			expect(chmod).not.toHaveBeenCalled();
			expect(addPath).toHaveBeenCalledWith("/cached/biome/1.0.0");
		});

		it("fails with ToolInstallerError on addPath failure", async () => {
			const find = vi.fn<(name: string, version: string) => string>().mockReturnValue("");
			const downloadTool = vi.fn<(url: string) => Promise<string>>().mockResolvedValue("/tmp/download");
			const cacheFile = vi
				.fn<(sourceFile: string, targetFile: string, tool: string, version: string) => Promise<string>>()
				.mockResolvedValue("/cached/biome/1.0.0");
			const addPath = vi.fn<(path: string) => void>().mockImplementation(() => {
				throw new Error("Cannot modify PATH");
			});

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installBinaryAndAddToPath("biome", "1.0.0", "https://example.com/biome"),
				),
				{ find, downloadTool, cacheFile },
				{ addPath },
			);

			expect(error.operation).toBe("path");
			expect(error.tool).toBe("biome");
		});
	});
});
