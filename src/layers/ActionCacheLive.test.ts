import { createHash } from "node:crypto";
import { Cause, Effect, Exit, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCacheError } from "../errors/ActionCacheError.js";
import { ActionCache } from "../services/ActionCache.js";
import { ActionCacheLive } from "./ActionCacheLive.js";
import { ActionCacheTest } from "./ActionCacheTest.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUploadFile = vi.fn().mockResolvedValue(undefined);
const mockDownloadToFile = vi.fn().mockResolvedValue(undefined);

vi.mock("@azure/storage-blob", () => ({
	BlockBlobClient: class MockBlockBlobClient {
		uploadFile = mockUploadFile;
		constructor(public url: string) {}
	},
	BlobClient: class MockBlobClient {
		downloadToFile = mockDownloadToFile;
		constructor(public url: string) {}
	},
}));

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(),
		globSync: vi.fn(),
		statSync: vi.fn(),
		unlinkSync: vi.fn(),
	};
});

import { execFileSync } from "node:child_process";
import { existsSync, globSync, statSync, unlinkSync } from "node:fs";

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedGlobSync = vi.mocked(globSync);
const mockedStatSync = vi.mocked(statSync);
const mockedUnlinkSync = vi.mocked(unlinkSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runLiveExit = <A, E>(effect: Effect.Effect<A, E, ActionCache>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionCacheLive)));

const extractError = (exit: Exit.Exit<unknown, ActionCacheError>): ActionCacheError | undefined => {
	if (Exit.isFailure(exit)) {
		const option = Cause.failureOption(exit.cause);
		if (Option.isSome(option)) {
			return option.value;
		}
	}
	return undefined;
};

/**
 * Build a minimal Twirp-style fetch Response.
 * Use status 400/404/409 for non-retryable errors (500/502/503/504 trigger retries).
 */
const makeTwirpResponse = (status: number, body: unknown = null): Response => {
	const ok = status >= 200 && status < 300;
	return {
		ok,
		status,
		json: vi.fn().mockResolvedValue(body),
		text: vi.fn().mockResolvedValue(JSON.stringify(body)),
	} as unknown as Response;
};

// ---------------------------------------------------------------------------
// Live layer tests
// ---------------------------------------------------------------------------

describe("ActionCacheLive", () => {
	describe("save", () => {
		it("fails with ActionCacheError when env vars are missing", async () => {
			const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "my-key")));
			expect(Exit.isFailure(exit)).toBe(true);
			const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
			expect(error).toBeDefined();
			expect(error?._tag).toBe("ActionCacheError");
			expect(error?.reason).toContain("ACTIONS_RESULTS_URL");
		});

		describe("with env vars set", () => {
			beforeEach(() => {
				vi.stubEnv("ACTIONS_RESULTS_URL", "https://results.example.com/");
				vi.stubEnv("ACTIONS_RUNTIME_TOKEN", "test-token");
				vi.stubEnv("HOME", "/home/runner");
				mockedExecFileSync.mockReturnValue(Buffer.from(""));
				mockedStatSync.mockReturnValue({ size: 100 } as ReturnType<typeof statSync>);
				mockedUnlinkSync.mockReturnValue(undefined);
				mockedExistsSync.mockReturnValue(true);
				mockedGlobSync.mockImplementation((pattern) => [pattern] as unknown as string[]);
				mockUploadFile.mockResolvedValue(undefined);
				mockDownloadToFile.mockResolvedValue(undefined);
			});

			afterEach(() => {
				vi.unstubAllEnvs();
				vi.clearAllMocks();
			});

			it("expands relative glob patterns before passing to tar", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: true, entry_id: "entry-1" }));

				mockedGlobSync.mockReturnValueOnce(["project/.yarn/cache"] as unknown as string[]);
				mockedGlobSync.mockReturnValueOnce(["project/node_modules"] as unknown as string[]);

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) =>
						svc.save(["/home/runner/.cache", "**/.yarn/cache", "**/node_modules"], "glob-key"),
					),
				);

				expect(Exit.isSuccess(exit)).toBe(true);

				// globSync should be called for the two glob patterns, not the absolute path
				expect(mockedGlobSync).toHaveBeenCalledTimes(2);
				expect(mockedGlobSync).toHaveBeenCalledWith("**/.yarn/cache");
				expect(mockedGlobSync).toHaveBeenCalledWith("**/node_modules");

				// tar should receive the resolved paths, not the glob patterns
				const tarArgs = mockedExecFileSync.mock.calls[0]?.[1] as string[];
				expect(tarArgs).toContain("/home/runner/.cache");
				expect(tarArgs).toContain("project/.yarn/cache");
				expect(tarArgs).toContain("project/node_modules");
				expect(tarArgs).not.toContain("**/.yarn/cache");
				expect(tarArgs).not.toContain("**/node_modules");

				fetchSpy.mockRestore();
			});

			it("expands absolute paths containing glob wildcards", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: true, entry_id: "entry-1" }));

				mockedGlobSync.mockReturnValueOnce(["/opt/hostedtoolcache/bun/1.3.3/x64"] as unknown as string[]);

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.save(["/opt/hostedtoolcache/bun/1.3.3/*"], "abs-glob-key")),
				);

				expect(Exit.isSuccess(exit)).toBe(true);
				expect(mockedGlobSync).toHaveBeenCalledWith("/opt/hostedtoolcache/bun/1.3.3/*");

				const tarArgs = mockedExecFileSync.mock.calls[0]?.[1] as string[];
				expect(tarArgs).toContain("/opt/hostedtoolcache/bun/1.3.3/x64");
				expect(tarArgs).not.toContain("/opt/hostedtoolcache/bun/1.3.3/*");

				fetchSpy.mockRestore();
			});

			it("resolves tilde paths to HOME before passing to tar", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: true, entry_id: "entry-1" }));

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.save(["~/.bun/install/cache", "~/.cache/deno"], "tilde-key")),
				);

				expect(Exit.isSuccess(exit)).toBe(true);

				const tarArgs = mockedExecFileSync.mock.calls[0]?.[1] as string[];
				expect(tarArgs).toContain("/home/runner/.bun/install/cache");
				expect(tarArgs).toContain("/home/runner/.cache/deno");
				expect(tarArgs).not.toContain("~/.bun/install/cache");
				expect(tarArgs).not.toContain("~/.cache/deno");

				fetchSpy.mockRestore();
			});

			it("filters out non-existent paths", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: true, entry_id: "entry-1" }));

				mockedExistsSync.mockImplementation((p) => p !== "/home/runner/.bun/install/cache");

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.save(["~/.bun/install/cache", "/opt/real-path"], "filter-key")),
				);

				expect(Exit.isSuccess(exit)).toBe(true);

				const tarArgs = mockedExecFileSync.mock.calls[0]?.[1] as string[];
				expect(tarArgs).toContain("/opt/real-path");
				expect(tarArgs).not.toContain("/home/runner/.bun/install/cache");

				fetchSpy.mockRestore();
			});

			it("deduplicates paths where parent already covers child", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: true, entry_id: "entry-1" }));

				mockedGlobSync.mockReturnValueOnce(["/opt/hostedtoolcache/bun/1.3.3/x64"] as unknown as string[]);

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) =>
						svc.save(["/opt/hostedtoolcache/bun/1.3.3", "/opt/hostedtoolcache/bun/1.3.3/*"], "dedup-key"),
					),
				);

				expect(Exit.isSuccess(exit)).toBe(true);

				const tarArgs = mockedExecFileSync.mock.calls[0]?.[1] as string[];
				// Parent directory should be included
				expect(tarArgs).toContain("/opt/hostedtoolcache/bun/1.3.3");
				// Child expanded from glob should be deduplicated away
				expect(tarArgs).not.toContain("/opt/hostedtoolcache/bun/1.3.3/x64");

				fetchSpy.mockRestore();
			});

			it("fails when all paths resolve to zero existing files", async () => {
				mockedGlobSync.mockImplementation(() => [] as unknown as string[]);
				mockedExistsSync.mockReturnValue(false);

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.save(["**/nonexistent"], "empty-glob-key")),
				);

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("save");
				expect(error?.reason).toContain("No files matched");
			});

			it("succeeds with full CreateCacheEntry → upload → FinalizeCacheEntry flow", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				// CreateCacheEntry
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);
				// FinalizeCacheEntryUpload
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: true, entry_id: "entry-1" }));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
				expect(fetchSpy).toHaveBeenCalledTimes(2);

				// Verify CreateCacheEntry call
				const [createUrl, createInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
				expect(createUrl).toContain("twirp/github.actions.results.api.v1.CacheService/CreateCacheEntry");
				expect(createInit.method).toBe("POST");
				expect(JSON.parse(createInit.body as string)).toMatchObject({ key: "test-key" });

				// Verify FinalizeCacheEntryUpload call
				const [finalizeUrl, finalizeInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
				expect(finalizeUrl).toContain("twirp/github.actions.results.api.v1.CacheService/FinalizeCacheEntryUpload");
				expect(finalizeInit.method).toBe("POST");
				expect(JSON.parse(finalizeInit.body as string)).toMatchObject({ key: "test-key", size_bytes: "100" });

				// Verify Azure BlockBlobClient was used for upload
				expect(mockUploadFile).toHaveBeenCalled();

				fetchSpy.mockRestore();
			});

			it("cleans up temp archive on successful save", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: true, entry_id: "entry-1" }));

				await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(mockedUnlinkSync).toHaveBeenCalled();

				fetchSpy.mockRestore();
			});

			it("fails when archive creation (tar) throws", async () => {
				mockedExecFileSync.mockImplementation(() => {
					throw new Error("tar not found");
				});

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("save");
				expect(error?.reason).toContain("Failed to create archive");
				expect(error?.reason).toContain("tar not found");
			});

			it("fails when CreateCacheEntry returns non-ok HTTP status", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				// Use 409 (non-retryable) to avoid 3s+ retry delays
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(409));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("save");
				expect(error?.reason).toContain("CreateCacheEntry failed");
				expect(error?.reason).toContain("HTTP 409");

				fetchSpy.mockRestore();
			});

			it("fails when CreateCacheEntry returns ok but no upload URL", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: false }));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("save");
				expect(error?.reason).toContain("CreateCacheEntry did not return a signed upload URL");

				fetchSpy.mockRestore();
			});

			it("fails when Azure upload rejects", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);

				mockUploadFile.mockRejectedValueOnce(new Error("Azure upload timeout"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("save");
				expect(error?.reason).toContain("Archive upload failed");
				expect(error?.reason).toContain("Azure upload timeout");

				fetchSpy.mockRestore();
			});

			it("fails when FinalizeCacheEntryUpload returns non-ok HTTP status", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);
				// Use 409 (non-retryable) to avoid retry delays
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(409));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("save");
				expect(error?.reason).toContain("FinalizeCacheEntryUpload failed");
				expect(error?.reason).toContain("HTTP 409");

				fetchSpy.mockRestore();
			});

			it("fails when FinalizeCacheEntryUpload returns ok:false at HTTP 200", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
				);
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: false }));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("save");
				expect(error?.reason).toContain("FinalizeCacheEntryUpload did not confirm success");

				fetchSpy.mockRestore();
			});
		});
	});

	describe("restore", () => {
		it("fails with ActionCacheError when env vars are missing", async () => {
			const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));
			expect(Exit.isFailure(exit)).toBe(true);
			const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
			expect(error).toBeDefined();
			expect(error?._tag).toBe("ActionCacheError");
			expect(error?.reason).toContain("ACTIONS_RESULTS_URL");
		});

		describe("with env vars set", () => {
			beforeEach(() => {
				vi.stubEnv("ACTIONS_RESULTS_URL", "https://results.example.com/");
				vi.stubEnv("ACTIONS_RUNTIME_TOKEN", "test-token");
				mockedExecFileSync.mockReturnValue(Buffer.from(""));
				mockedUnlinkSync.mockReturnValue(undefined);
				mockUploadFile.mockResolvedValue(undefined);
				mockDownloadToFile.mockResolvedValue(undefined);
			});

			afterEach(() => {
				vi.unstubAllEnvs();
				vi.clearAllMocks();
			});

			it("returns None on cache miss (ok: false)", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: false }));

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "missing-key")),
				);

				expect(Exit.isSuccess(exit)).toBe(true);
				if (Exit.isSuccess(exit)) {
					expect(Option.isNone(exit.value as Option.Option<string>)).toBe(true);
				}

				fetchSpy.mockRestore();
			});

			it("returns Some with matched_key on cache hit", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, {
						ok: true,
						signed_download_url: "https://azure.example.com/download",
						matched_key: "my-key-abc",
					}),
				);

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
				if (Exit.isSuccess(exit)) {
					const result = exit.value as Option.Option<string>;
					expect(Option.isSome(result)).toBe(true);
					if (Option.isSome(result)) {
						expect(result.value).toBe("my-key-abc");
					}
				}

				// Verify Azure BlobClient was used for download
				expect(mockDownloadToFile).toHaveBeenCalled();

				// tar extraction should have been invoked
				expect(mockedExecFileSync).toHaveBeenCalledWith("tar", expect.arrayContaining(["xzf"]), expect.any(Object));

				fetchSpy.mockRestore();
			});

			it("returns Some with primaryKey when response has no matched_key", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, {
						ok: true,
						signed_download_url: "https://azure.example.com/download",
						// no matched_key
					}),
				);

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "primary-key")),
				);

				expect(Exit.isSuccess(exit)).toBe(true);
				if (Exit.isSuccess(exit)) {
					const result = exit.value as Option.Option<string>;
					expect(Option.isSome(result)).toBe(true);
					if (Option.isSome(result)) {
						expect(result.value).toBe("primary-key");
					}
				}

				fetchSpy.mockRestore();
			});

			it("fails when GetCacheEntryDownloadURL returns non-ok HTTP status", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				// Use 409 (non-retryable) to avoid retry delays
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(409));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("restore");
				expect(error?.reason).toContain("GetCacheEntryDownloadURL failed");
				expect(error?.reason).toContain("HTTP 409");

				fetchSpy.mockRestore();
			});

			it("fails when Azure download rejects", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, {
						ok: true,
						signed_download_url: "https://azure.example.com/download",
						matched_key: "my-key",
					}),
				);

				mockDownloadToFile.mockRejectedValueOnce(new Error("Azure download timeout"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("restore");
				expect(error?.reason).toContain("Archive download failed");
				expect(error?.reason).toContain("Azure download timeout");

				fetchSpy.mockRestore();
			});

			it("fails when tar extraction fails", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeTwirpResponse(200, {
						ok: true,
						signed_download_url: "https://azure.example.com/download",
						matched_key: "my-key",
					}),
				);

				mockedExecFileSync.mockImplementation(() => {
					throw new Error("tar extraction error");
				});

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("restore");
				expect(error?.reason).toContain("Failed to extract archive");
				expect(error?.reason).toContain("tar extraction error");

				fetchSpy.mockRestore();
			});

			it("sends restore_keys in the Twirp request body", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: false }));

				await runLiveExit(
					Effect.flatMap(ActionCache, (svc) =>
						svc.restore(["node_modules"], "primary-key", ["restore-key-1", "restore-key-2"]),
					),
				);

				const [, lookupInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
				const body = JSON.parse(lookupInit.body as string);
				expect(body.key).toBe("primary-key");
				expect(body.restore_keys).toEqual(["restore-key-1", "restore-key-2"]);

				fetchSpy.mockRestore();
			});
		});
	});
});

// ---------------------------------------------------------------------------
// Version hash tests
// ---------------------------------------------------------------------------

describe("version hash", () => {
	const computeVersion = (paths: ReadonlyArray<string>): string => {
		const components = [...paths, "gzip", "1.0"];
		return createHash("sha256").update(components.join("|")).digest("hex");
	};

	it("sends version matching @actions/cache format (paths|gzip|1.0)", async () => {
		vi.stubEnv("ACTIONS_RESULTS_URL", "https://results.example.com/");
		vi.stubEnv("ACTIONS_RUNTIME_TOKEN", "test-token");
		vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
		vi.mocked(statSync).mockReturnValue({ size: 100 } as ReturnType<typeof statSync>);
		vi.mocked(unlinkSync).mockReturnValue(undefined);
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(globSync).mockImplementation((pattern) => [pattern] as unknown as string[]);
		mockUploadFile.mockResolvedValue(undefined);

		const fetchSpy = vi.spyOn(globalThis, "fetch");
		fetchSpy.mockResolvedValueOnce(
			makeTwirpResponse(200, { ok: true, signed_upload_url: "https://azure.example.com/upload" }),
		);
		fetchSpy.mockResolvedValueOnce(makeTwirpResponse(200, { ok: true }));

		await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules", ".cache"], "version-test-key")));

		const [, createInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(createInit.body as string);
		const expectedVersion = computeVersion(["node_modules", ".cache"]);
		expect(body.version).toBe(expectedVersion);

		fetchSpy.mockRestore();
		vi.unstubAllEnvs();
	});

	it("version is NOT order-independent (matches upstream behavior)", () => {
		const hash1 = computeVersion(["a", "b"]);
		const hash2 = computeVersion(["b", "a"]);
		expect(hash1).not.toBe(hash2);
	});
});

// ---------------------------------------------------------------------------
// Test layer round-trip tests (unchanged)
// ---------------------------------------------------------------------------

describe("ActionCacheTest round-trip", () => {
	const provide = <A, E>(state: ReturnType<typeof ActionCacheTest.empty>, effect: Effect.Effect<A, E, ActionCache>) =>
		Effect.provide(effect, ActionCacheTest.layer(state));

	const run = <A, E>(state: ReturnType<typeof ActionCacheTest.empty>, effect: Effect.Effect<A, E, ActionCache>) =>
		Effect.runPromise(provide(state, effect));

	it("save then restore returns Some with matched key", async () => {
		const state = ActionCacheTest.empty();
		await run(
			state,
			Effect.flatMap(ActionCache, (svc) => svc.save(["path/a"], "my-key")),
		);
		const result = await run(
			state,
			Effect.flatMap(ActionCache, (svc) => svc.restore(["path/a"], "my-key")),
		);
		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value).toBe("my-key");
		}
	});

	it("restore returns None on cache miss", async () => {
		const state = ActionCacheTest.empty();
		const result = await run(
			state,
			Effect.flatMap(ActionCache, (svc) => svc.restore(["path/a"], "missing-key")),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("restore with restore keys finds prefix match", async () => {
		const state = ActionCacheTest.empty();
		state.entries.set("cache-abc123", ["path/a"]);
		const result = await run(
			state,
			Effect.flatMap(ActionCache, (svc) => svc.restore(["path/a"], "cache-xyz", ["cache-"])),
		);
		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value).toBe("cache-abc123");
		}
	});

	it("save stores paths in state", async () => {
		const state = ActionCacheTest.empty();
		await run(
			state,
			Effect.flatMap(ActionCache, (svc) => svc.save(["path/a", "path/b"], "my-key")),
		);
		expect(state.entries.get("my-key")).toEqual(["path/a", "path/b"]);
	});
});
