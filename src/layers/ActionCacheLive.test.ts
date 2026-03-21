import { createHash } from "node:crypto";
import { Cause, Effect, Exit, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCacheError } from "../errors/ActionCacheError.js";
import { ActionCache } from "../services/ActionCache.js";
import { ActionCacheLive } from "./ActionCacheLive.js";
import { ActionCacheTest } from "./ActionCacheTest.js";

// Mock node:child_process so execFileSync can be controlled per test
vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

// Mock node:fs so statSync/unlinkSync/createReadStream/createWriteStream can be controlled per test
vi.mock("node:fs", async (importOriginal) => {
	const { Readable, Writable } = await import("node:stream");
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		statSync: vi.fn(),
		unlinkSync: vi.fn(),
		// Default createReadStream returns a small stream of 'a' bytes for any range
		createReadStream: vi.fn((_path: string, opts?: { start?: number; end?: number }) => {
			const start = opts?.start ?? 0;
			const end = opts?.end ?? 99;
			const chunk = Buffer.alloc(end - start + 1, 0x61);
			return Readable.from([chunk]);
		}),
		// Default createWriteStream returns a no-op writable (discards data)
		createWriteStream: vi.fn(
			() =>
				new Writable({
					write(_chunk, _enc, cb) {
						cb();
					},
				}),
		),
	};
});

// Import mocked modules so we can configure them in tests
import { execFileSync } from "node:child_process";
import { createReadStream, statSync, unlinkSync } from "node:fs";
import { Readable } from "node:stream";

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedCreateReadStream = vi.mocked(createReadStream);
const mockedStatSync = vi.mocked(statSync);
const mockedUnlinkSync = vi.mocked(unlinkSync);

/**
 * We cannot test the Live layer against real cache service (requires Actions runner).
 * These tests verify:
 * 1. Missing env vars produce ActionCacheError
 * 2. Version hash computation is deterministic
 * 3. Test layer round-trip works correctly
 * 4. HTTP interaction paths (cache hit, miss, error, download failures, etc.)
 */

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

/** Build a minimal fetch Response-like object with a readable body stream */
const makeFetchResponse = (status: number, body: unknown = null): Response => {
	const ok = status >= 200 && status < 300;
	const jsonBody = body !== null ? JSON.stringify(body) : "";
	// Provide a real ReadableStream so Readable.fromWeb() works in restore tests
	const bodyStream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode("archive-data"));
			controller.close();
		},
	});
	return {
		ok,
		status,
		text: vi.fn().mockResolvedValue(jsonBody),
		json: vi.fn().mockResolvedValue(body),
		arrayBuffer: vi.fn().mockResolvedValue(Buffer.from("archive-data").buffer),
		body: bodyStream,
	} as unknown as Response;
};

/** Build a Response with no body stream (body: null) */
const makeBodylessResponse = (status: number): Response =>
	({
		ok: status >= 200 && status < 300,
		status,
		text: vi.fn().mockResolvedValue(""),
		json: vi.fn().mockResolvedValue(null),
		arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
		body: null,
	}) as unknown as Response;

describe("ActionCacheLive", () => {
	describe("save", () => {
		it("fails with ActionCacheError when env vars are missing", async () => {
			const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "my-key")));
			expect(Exit.isFailure(exit)).toBe(true);
			const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
			expect(error).toBeDefined();
			expect(error?._tag).toBe("ActionCacheError");
			expect(error?.reason).toContain("ACTIONS_CACHE_URL");
		});

		describe("with env vars set", () => {
			beforeEach(() => {
				process.env.ACTIONS_CACHE_URL = "https://cache.example.com/";
				process.env.ACTIONS_RUNTIME_TOKEN = "test-token";
				// Default: execFileSync (tar) succeeds silently
				mockedExecFileSync.mockReturnValue(Buffer.from(""));
				// Default: archive is 100 bytes
				mockedStatSync.mockReturnValue({ size: 100 } as ReturnType<typeof statSync>);
				mockedUnlinkSync.mockReturnValue(undefined);

				// Default createReadStream: return 'a' bytes matching the requested range
				mockedCreateReadStream.mockImplementation(
					// biome-ignore lint/suspicious/noExplicitAny: mock type override
					((_path: any, opts: any) => {
						const { start = 0, end = 99 } = (opts as { start?: number; end?: number }) ?? {};
						const chunk = Buffer.alloc(end - start + 1, 0x61);
						return Readable.from([chunk]);
					}) as typeof createReadStream,
				);
			});

			afterEach(() => {
				delete process.env.ACTIONS_CACHE_URL;
				delete process.env.ACTIONS_RUNTIME_TOKEN;
				vi.clearAllMocks();
			});

			it("succeeds with full reserve → upload → commit flow", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { cacheId: 42 }));
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204));
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
				expect(fetchSpy).toHaveBeenCalledTimes(3);

				// Verify reserve call
				const [reserveUrl, reserveInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
				expect(reserveUrl).toContain("_apis/artifactcache/caches");
				expect(reserveInit.method).toBe("POST");
				expect(JSON.parse(reserveInit.body as string)).toMatchObject({ key: "test-key" });

				// Verify commit call
				const [commitUrl, commitInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
				expect(commitUrl).toContain("_apis/artifactcache/caches/42");
				expect(commitInit.method).toBe("POST");

				fetchSpy.mockRestore();
			});

			it("cleans up temp archive on successful save", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { cacheId: 42 }));
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204));
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204));

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

			it("fails when reserve request returns non-ok status", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(409, "conflict"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("save");
				expect(error?.reason).toContain("Cache reserve failed");
				expect(error?.reason).toContain("409");

				fetchSpy.mockRestore();
			});

			it("fails when reserve fetch rejects", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockRejectedValueOnce(new Error("network error"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.reason).toContain("Cache reserve request failed");
				expect(error?.reason).toContain("network error");

				fetchSpy.mockRestore();
			});

			it("fails when chunk stream read errors", async () => {
				// Return a stream that emits an error event instead of data
				mockedCreateReadStream.mockImplementation((() => {
					const readable = new Readable({ read() {} });
					setImmediate(() => readable.destroy(new Error("disk read error")));
					return readable;
				}) as unknown as typeof createReadStream);

				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { cacheId: 42 }));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.reason).toContain("Failed to read archive chunk");
				expect(error?.reason).toContain("disk read error");

				fetchSpy.mockRestore();
			});

			it("fails when chunk upload returns non-ok status", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { cacheId: 42 }));
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(500));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.reason).toContain("Chunk upload failed with status 500");

				fetchSpy.mockRestore();
			});

			it("fails when chunk upload fetch rejects", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { cacheId: 42 }));
				fetchSpy.mockRejectedValueOnce(new Error("upload network error"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.reason).toContain("Chunk upload failed");
				expect(error?.reason).toContain("upload network error");

				fetchSpy.mockRestore();
			});

			it("fails when commit request returns non-ok status", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { cacheId: 42 }));
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204)); // upload ok
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(500)); // commit fails

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.reason).toContain("Cache commit failed with status 500");

				fetchSpy.mockRestore();
			});

			it("fails when commit fetch rejects", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { cacheId: 42 }));
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204)); // upload ok
				fetchSpy.mockRejectedValueOnce(new Error("commit network error"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.reason).toContain("Cache commit failed");
				expect(error?.reason).toContain("commit network error");

				fetchSpy.mockRestore();
			});

			it("sends multiple chunk uploads for large files (>32 MB)", async () => {
				const CHUNK = 32 * 1024 * 1024;
				const fileSize = CHUNK + 1024; // just over one chunk boundary
				mockedStatSync.mockReturnValue({ size: fileSize } as ReturnType<typeof statSync>);

				// createReadStream returns the exact byte count for the requested range
				mockedCreateReadStream.mockImplementation(
					// biome-ignore lint/suspicious/noExplicitAny: mock type override
					((_path: any, opts: any) => {
						const { start = 0, end = fileSize - 1 } = (opts as { start?: number; end?: number }) ?? {};
						const chunk = Buffer.alloc(end - start + 1, 0x61);
						return Readable.from([chunk]);
					}) as typeof createReadStream,
				);

				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { cacheId: 99 }));
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204)); // chunk 1
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204)); // chunk 2
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204)); // commit

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["big-file"], "large-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
				// 1 reserve + 2 uploads + 1 commit = 4
				expect(fetchSpy).toHaveBeenCalledTimes(4);

				// Verify Content-Range headers on the two upload calls
				const [, firstUploadInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
				const [, secondUploadInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
				const headers1 = firstUploadInit.headers as Record<string, string>;
				const headers2 = secondUploadInit.headers as Record<string, string>;
				expect(headers1["Content-Range"]).toBe(`bytes 0-${CHUNK - 1}/*`);
				expect(headers2["Content-Range"]).toBe(`bytes ${CHUNK}-${fileSize - 1}/*`);

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
			expect(error?.reason).toContain("ACTIONS_CACHE_URL");
		});

		describe("with env vars set", () => {
			beforeEach(() => {
				process.env.ACTIONS_CACHE_URL = "https://cache.example.com/";
				process.env.ACTIONS_RUNTIME_TOKEN = "test-token";
				mockedExecFileSync.mockReturnValue(Buffer.from(""));
				mockedUnlinkSync.mockReturnValue(undefined);
			});

			afterEach(() => {
				delete process.env.ACTIONS_CACHE_URL;
				delete process.env.ACTIONS_RUNTIME_TOKEN;
				vi.clearAllMocks();
			});

			it("returns None on cache miss (204 status)", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204));

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "missing-key")),
				);

				expect(Exit.isSuccess(exit)).toBe(true);
				if (Exit.isSuccess(exit)) {
					expect(Option.isNone(exit.value as Option.Option<string>)).toBe(true);
				}

				fetchSpy.mockRestore();
			});

			it("returns Some with cacheKey on cache hit (200 with archiveLocation)", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeFetchResponse(200, {
						archiveLocation: "https://blob.example.com/archive.tar.gz",
						cacheKey: "my-key-abc",
					}),
				);
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
				if (Exit.isSuccess(exit)) {
					const result = exit.value as Option.Option<string>;
					expect(Option.isSome(result)).toBe(true);
					if (Option.isSome(result)) {
						expect(result.value).toBe("my-key-abc");
					}
				}

				// tar extraction should have been invoked
				expect(mockedExecFileSync).toHaveBeenCalledWith("tar", expect.arrayContaining(["xzf"]), expect.any(Object));

				fetchSpy.mockRestore();
			});

			it("returns Some with primaryKey when response has no cacheKey field", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeFetchResponse(200, {
						archiveLocation: "https://blob.example.com/archive.tar.gz",
						// no cacheKey
					}),
				);
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200));

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

			it("returns None when response has no archiveLocation", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200, { cacheKey: "some-key" }));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
				if (Exit.isSuccess(exit)) {
					expect(Option.isNone(exit.value as Option.Option<string>)).toBe(true);
				}

				fetchSpy.mockRestore();
			});

			it("fails when cache lookup request returns non-ok status", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(500));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("restore");
				expect(error?.reason).toContain("Cache lookup failed with status 500");

				fetchSpy.mockRestore();
			});

			it("fails when cache lookup fetch rejects", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockRejectedValueOnce(new Error("lookup network error"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.reason).toContain("Cache lookup request failed");
				expect(error?.reason).toContain("lookup network error");

				fetchSpy.mockRestore();
			});

			it("fails when archive download returns non-ok status", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeFetchResponse(200, {
						archiveLocation: "https://blob.example.com/archive.tar.gz",
						cacheKey: "my-key",
					}),
				);
				// Non-ok download response — inner throw gets caught and wrapped
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(403));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("restore");
				expect(error?.reason).toContain("Archive download failed");
				expect(error?.reason).toContain("403");

				fetchSpy.mockRestore();
			});

			it("fails when archive download response has no body", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeFetchResponse(200, {
						archiveLocation: "https://blob.example.com/archive.tar.gz",
						cacheKey: "my-key",
					}),
				);
				// ok=true but body=null — triggers the !body branch inside tryPromise
				fetchSpy.mockResolvedValueOnce(makeBodylessResponse(200));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.operation).toBe("restore");
				expect(error?.reason).toContain("Archive download failed");

				fetchSpy.mockRestore();
			});

			it("fails when archive download fetch rejects", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeFetchResponse(200, {
						archiveLocation: "https://blob.example.com/archive.tar.gz",
						cacheKey: "my-key",
					}),
				);
				fetchSpy.mockRejectedValueOnce(new Error("download network error"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?._tag).toBe("ActionCacheError");
				expect(error?.reason).toContain("Archive download failed");
				expect(error?.reason).toContain("download network error");

				fetchSpy.mockRestore();
			});

			it("fails when tar extraction fails", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(
					makeFetchResponse(200, {
						archiveLocation: "https://blob.example.com/archive.tar.gz",
						cacheKey: "my-key",
					}),
				);
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(200));

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

			it("passes restoreKeys in the query string", async () => {
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204));

				await runLiveExit(
					Effect.flatMap(ActionCache, (svc) =>
						svc.restore(["node_modules"], "primary-key", ["restore-key-1", "restore-key-2"]),
					),
				);

				const [lookupUrl] = fetchSpy.mock.calls[0] as [string];
				expect(lookupUrl).toContain("primary-key");
				expect(lookupUrl).toContain("restore-key-1");
				expect(lookupUrl).toContain("restore-key-2");

				fetchSpy.mockRestore();
			});

			it("uses trailing slash for base URL even if ACTIONS_CACHE_URL lacks one", async () => {
				process.env.ACTIONS_CACHE_URL = "https://cache.example.com"; // no trailing slash
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				fetchSpy.mockResolvedValueOnce(makeFetchResponse(204));

				await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "key")));

				const [lookupUrl] = fetchSpy.mock.calls[0] as [string];
				expect(lookupUrl).toMatch(/^https:\/\/cache\.example\.com\/_apis/);

				fetchSpy.mockRestore();
			});
		});
	});
});

describe("version hash", () => {
	it("is deterministic for same paths", () => {
		const hash1 = createHash("sha256").update(["a", "b"].sort().join("|")).digest("hex");
		const hash2 = createHash("sha256").update(["a", "b"].sort().join("|")).digest("hex");
		expect(hash1).toBe(hash2);
	});

	it("is order-independent", () => {
		const hash1 = createHash("sha256").update(["b", "a"].sort().join("|")).digest("hex");
		const hash2 = createHash("sha256").update(["a", "b"].sort().join("|")).digest("hex");
		expect(hash1).toBe(hash2);
	});

	it("differs for different paths", () => {
		const hash1 = createHash("sha256").update(["a"].sort().join("|")).digest("hex");
		const hash2 = createHash("sha256").update(["b"].sort().join("|")).digest("hex");
		expect(hash1).not.toBe(hash2);
	});
});

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
