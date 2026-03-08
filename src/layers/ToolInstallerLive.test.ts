import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolInstallerError } from "../errors/ToolInstallerError.js";
import { ToolInstaller } from "../services/ToolInstaller.js";
import { ToolInstallerLive } from "./ToolInstallerLive.js";

// -- Mock @actions/tool-cache --

const mockFind = vi.fn<(name: string, version: string) => string>();
const mockDownloadTool = vi.fn<(url: string) => Promise<string>>();
const mockExtractTar = vi.fn<(path: string, dest?: string, flags?: string | string[]) => Promise<string>>();
const mockExtractZip = vi.fn<(path: string) => Promise<string>>();
const mockCacheDir = vi.fn<(dir: string, tool: string, version: string) => Promise<string>>();

vi.mock("@actions/tool-cache", () => ({
	find: (...args: [string, string]) => mockFind(...args),
	downloadTool: (...args: [string]) => mockDownloadTool(...args),
	extractTar: (...args: [string, string?, (string | string[])?]) => mockExtractTar(...args),
	extractZip: (...args: [string]) => mockExtractZip(...args),
	cacheDir: (...args: [string, string, string]) => mockCacheDir(...args),
}));

// -- Mock @actions/core --

const mockAddPath = vi.fn<(path: string) => void>();

vi.mock("@actions/core", () => ({
	addPath: (...args: [string]) => mockAddPath(...args),
}));

const run = <A, E>(effect: Effect.Effect<A, E, ToolInstaller>) =>
	Effect.runPromise(Effect.provide(effect, ToolInstallerLive));

const runFail = <A>(effect: Effect.Effect<A, ToolInstallerError, ToolInstaller>) =>
	Effect.runPromise(Effect.flip(Effect.provide(effect, ToolInstallerLive)));

describe("ToolInstallerLive", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("install", () => {
		it("returns cached path when tool is already cached", async () => {
			mockFind.mockReturnValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
			);

			expect(result).toBe("/cached/node/20.0.0");
			expect(mockDownloadTool).not.toHaveBeenCalled();
		});

		it("downloads, extracts tar.gz, and caches when not cached", async () => {
			mockFind.mockReturnValue("");
			mockDownloadTool.mockResolvedValue("/tmp/download");
			mockExtractTar.mockResolvedValue("/tmp/extracted");
			mockCacheDir.mockResolvedValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
			);

			expect(result).toBe("/cached/node/20.0.0");
			expect(mockDownloadTool).toHaveBeenCalledWith("https://example.com/node.tar.gz");
			expect(mockExtractTar).toHaveBeenCalledWith("/tmp/download");
			expect(mockCacheDir).toHaveBeenCalledWith("/tmp/extracted", "node", "20.0.0");
		});

		it("extracts tar.xz with xJ flags", async () => {
			mockFind.mockReturnValue("");
			mockDownloadTool.mockResolvedValue("/tmp/download");
			mockExtractTar.mockResolvedValue("/tmp/extracted");
			mockCacheDir.mockResolvedValue("/cached/tool/1.0.0");

			await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("tool", "1.0.0", "https://example.com/tool.tar.xz", { archiveType: "tar.xz" }),
				),
			);

			expect(mockExtractTar).toHaveBeenCalledWith("/tmp/download", undefined, "xJ");
		});

		it("extracts zip archives", async () => {
			mockFind.mockReturnValue("");
			mockDownloadTool.mockResolvedValue("/tmp/download");
			mockExtractZip.mockResolvedValue("/tmp/extracted");
			mockCacheDir.mockResolvedValue("/cached/tool/1.0.0");

			await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("tool", "1.0.0", "https://example.com/tool.zip", { archiveType: "zip" }),
				),
			);

			expect(mockExtractZip).toHaveBeenCalledWith("/tmp/download");
		});

		it("appends binSubPath to cached path", async () => {
			mockFind.mockReturnValue("");
			mockDownloadTool.mockResolvedValue("/tmp/download");
			mockExtractTar.mockResolvedValue("/tmp/extracted");
			mockCacheDir.mockResolvedValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("node", "20.0.0", "https://example.com/node.tar.gz", { binSubPath: "bin" }),
				),
			);

			expect(result).toBe("/cached/node/20.0.0/bin");
		});

		it("appends binSubPath to already-cached path", async () => {
			mockFind.mockReturnValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.install("node", "20.0.0", "https://example.com/node.tar.gz", { binSubPath: "bin" }),
				),
			);

			expect(result).toBe("/cached/node/20.0.0/bin");
		});

		it("fails with download error when download fails", async () => {
			mockFind.mockReturnValue("");
			mockDownloadTool.mockRejectedValue(new Error("Network error"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
			);

			expect(error.operation).toBe("download");
			expect(error.tool).toBe("node");
			expect(error.version).toBe("20.0.0");
		});

		it("fails with extract error when extraction fails", async () => {
			mockFind.mockReturnValue("");
			mockDownloadTool.mockResolvedValue("/tmp/download");
			mockExtractTar.mockRejectedValue(new Error("Corrupt archive"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
			);

			expect(error.operation).toBe("extract");
		});

		it("fails with cache error when caching fails", async () => {
			mockFind.mockReturnValue("");
			mockDownloadTool.mockResolvedValue("/tmp/download");
			mockExtractTar.mockResolvedValue("/tmp/extracted");
			mockCacheDir.mockRejectedValue(new Error("Disk full"));

			const error = await runFail(
				Effect.flatMap(ToolInstaller, (svc) => svc.install("node", "20.0.0", "https://example.com/node.tar.gz")),
			);

			expect(error.operation).toBe("cache");
		});
	});

	describe("isCached", () => {
		it("returns true when tool is cached", async () => {
			mockFind.mockReturnValue("/cached/node/20.0.0");

			const result = await run(Effect.flatMap(ToolInstaller, (svc) => svc.isCached("node", "20.0.0")));

			expect(result).toBe(true);
		});

		it("returns false when tool is not cached", async () => {
			mockFind.mockReturnValue("");

			const result = await run(Effect.flatMap(ToolInstaller, (svc) => svc.isCached("node", "20.0.0")));

			expect(result).toBe(false);
		});
	});

	describe("installAndAddToPath", () => {
		it("installs and adds to PATH", async () => {
			mockFind.mockReturnValue("");
			mockDownloadTool.mockResolvedValue("/tmp/download");
			mockExtractTar.mockResolvedValue("/tmp/extracted");
			mockCacheDir.mockResolvedValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
			);

			expect(result).toBe("/cached/node/20.0.0");
			expect(mockAddPath).toHaveBeenCalledWith("/cached/node/20.0.0");
		});

		it("adds cached tool to PATH without downloading", async () => {
			mockFind.mockReturnValue("/cached/node/20.0.0");

			const result = await run(
				Effect.flatMap(ToolInstaller, (svc) =>
					svc.installAndAddToPath("node", "20.0.0", "https://example.com/node.tar.gz"),
				),
			);

			expect(result).toBe("/cached/node/20.0.0");
			expect(mockDownloadTool).not.toHaveBeenCalled();
			expect(mockAddPath).toHaveBeenCalledWith("/cached/node/20.0.0");
		});
	});
});
