import { createHash } from "node:crypto";
import { HttpClient, HttpClientError, HttpClientResponse } from "@effect/platform";
import { Cause, Duration, Effect, Exit, Fiber, Layer, Option, TestClock, TestContext } from "effect";
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
// HttpClient mock (replaces the prior globalThis.fetch spy)
// ---------------------------------------------------------------------------

interface TwirpReply {
	readonly status: number;
	readonly body?: unknown;
	/** When set, the request fails at the transport layer with this message. */
	readonly transportError?: string;
}

/** A captured Twirp request as seen by the mock client. */
interface CapturedTwirp {
	readonly url: string;
	readonly body: unknown;
	readonly headers: Record<string, string>;
}

let twirpReplies: Array<TwirpReply> = [];
let twirpCaptured: Array<CapturedTwirp> = [];

const mockHttpLayer: Layer.Layer<HttpClient.HttpClient> = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request, url) =>
		Effect.gen(function* () {
			const headers: Record<string, string> = {};
			for (const [k, v] of Object.entries(request.headers)) {
				if (typeof v === "string") headers[k.toLowerCase()] = v;
			}
			// HttpClientRequest bodies are an effectful stream; read the JSON text.
			const bodyText = yield* Effect.promise(async () => {
				const b = request.body as { body?: unknown };
				// `bodyUnsafeJson` stores a Uint8Array under `.body`.
				if (b && typeof b === "object" && "body" in b && b.body instanceof Uint8Array) {
					return new TextDecoder().decode(b.body);
				}
				return "";
			});
			const parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
			twirpCaptured.push({ url: url.toString(), body: parsedBody, headers });

			const reply = twirpReplies.shift() ?? { status: 500 };
			if (reply.transportError !== undefined) {
				// A transport-layer failure: the RequestError's `.message` carries
				// the underlying cause text (e.g. `ECONNRESET`) the retry schedule
				// keys off via `reason.includes(...)`.
				return yield* Effect.fail(
					new HttpClientError.RequestError({
						request,
						reason: "Transport",
						cause: new Error(reply.transportError),
						description: reply.transportError,
					}),
				);
			}
			const noBody = reply.status === 204 || reply.status === 304;
			return HttpClientResponse.fromWeb(
				request,
				new Response(noBody ? null : JSON.stringify(reply.body ?? null), {
					status: reply.status,
					headers: { "content-type": "application/json" },
				}),
			);
		}),
	),
);

const liveLayer = ActionCacheLive.pipe(Layer.provide(mockHttpLayer));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runLiveExit = <A, E>(effect: Effect.Effect<A, E, ActionCache>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, liveLayer)));

const extractError = (exit: Exit.Exit<unknown, ActionCacheError>): ActionCacheError | undefined => {
	if (Exit.isFailure(exit)) {
		const option = Cause.failureOption(exit.cause);
		if (Option.isSome(option)) {
			return option.value;
		}
	}
	return undefined;
};

const queueReplies = (...replies: Array<TwirpReply>): void => {
	twirpReplies.push(...replies);
};

beforeEach(() => {
	twirpReplies = [];
	twirpCaptured = [];
});

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

			it("does not put the runtime token in the request body and uses a Bearer header (S9)", async () => {
				queueReplies(
					{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
					{ status: 200, body: { ok: true, entry_id: "entry-1" } },
				);

				await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(twirpCaptured[0]?.headers.authorization).toBe("Bearer test-token");
				expect(JSON.stringify(twirpCaptured[0]?.body)).not.toContain("test-token");
			});

			it("expands relative glob patterns before passing to tar", async () => {
				queueReplies(
					{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
					{ status: 200, body: { ok: true, entry_id: "entry-1" } },
				);

				mockedGlobSync.mockReturnValueOnce(["project/.yarn/cache"] as unknown as string[]);
				mockedGlobSync.mockReturnValueOnce(["project/node_modules"] as unknown as string[]);

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) =>
						svc.save(["/home/runner/.cache", "**/.yarn/cache", "**/node_modules"], "glob-key"),
					),
				);

				expect(Exit.isSuccess(exit)).toBe(true);
				expect(mockedGlobSync).toHaveBeenCalledTimes(2);
				const tarArgs = mockedExecFileSync.mock.calls[0]?.[1] as string[];
				expect(tarArgs).toContain("/home/runner/.cache");
				expect(tarArgs).toContain("project/.yarn/cache");
				expect(tarArgs).toContain("project/node_modules");
				expect(tarArgs).not.toContain("**/.yarn/cache");
			});

			it("resolves tilde paths to HOME before passing to tar", async () => {
				queueReplies(
					{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
					{ status: 200, body: { ok: true, entry_id: "entry-1" } },
				);

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.save(["~/.bun/install/cache", "~/.cache/deno"], "tilde-key")),
				);

				expect(Exit.isSuccess(exit)).toBe(true);
				const tarArgs = mockedExecFileSync.mock.calls[0]?.[1] as string[];
				expect(tarArgs).toContain("/home/runner/.bun/install/cache");
				expect(tarArgs).toContain("/home/runner/.cache/deno");
				expect(tarArgs).not.toContain("~/.bun/install/cache");
			});

			it("filters out non-existent paths", async () => {
				queueReplies(
					{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
					{ status: 200, body: { ok: true, entry_id: "entry-1" } },
				);
				mockedExistsSync.mockImplementation((p) => p !== "/home/runner/.bun/install/cache");

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.save(["~/.bun/install/cache", "/opt/real-path"], "filter-key")),
				);

				expect(Exit.isSuccess(exit)).toBe(true);
				const tarArgs = mockedExecFileSync.mock.calls[0]?.[1] as string[];
				expect(tarArgs).toContain("/opt/real-path");
				expect(tarArgs).not.toContain("/home/runner/.bun/install/cache");
			});

			it("succeeds with full CreateCacheEntry → upload → FinalizeCacheEntry flow", async () => {
				queueReplies(
					{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
					{ status: 200, body: { ok: true, entry_id: "entry-1" } },
				);

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
				expect(twirpCaptured).toHaveLength(2);
				expect(twirpCaptured[0]?.url).toContain("twirp/github.actions.results.api.v1.CacheService/CreateCacheEntry");
				expect(twirpCaptured[0]?.body).toMatchObject({ key: "test-key" });
				expect(twirpCaptured[1]?.url).toContain(
					"twirp/github.actions.results.api.v1.CacheService/FinalizeCacheEntryUpload",
				);
				expect(twirpCaptured[1]?.body).toMatchObject({ key: "test-key", size_bytes: "100" });
				expect(mockUploadFile).toHaveBeenCalled();
			});

			it("cleans up temp archive on successful save", async () => {
				queueReplies(
					{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
					{ status: 200, body: { ok: true, entry_id: "entry-1" } },
				);

				await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(mockedUnlinkSync).toHaveBeenCalled();
			});

			it("fails when archive creation (tar) throws", async () => {
				mockedExecFileSync.mockImplementation(() => {
					throw new Error("tar not found");
				});

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?.reason).toContain("Failed to create archive");
				expect(error?.reason).toContain("tar not found");
			});

			it("treats HTTP 409 on CreateCacheEntry as silent success (cache already exists)", async () => {
				queueReplies({ status: 409 });

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
				expect(mockUploadFile).not.toHaveBeenCalled();
				expect(twirpCaptured).toHaveLength(1);
			});

			it("fails when CreateCacheEntry returns non-ok HTTP status", async () => {
				// 400 is non-retryable so the schedule does not delay.
				queueReplies({ status: 400 });

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?.operation).toBe("save");
				expect(error?.reason).toContain("CreateCacheEntry failed");
				expect(error?.reason).toContain("HTTP 400");
			});

			it("fails when CreateCacheEntry returns ok but no upload URL", async () => {
				queueReplies({ status: 200, body: { ok: false } });

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?.reason).toContain("CreateCacheEntry did not return a signed upload URL");
			});

			it("fails when Azure upload rejects", async () => {
				queueReplies({ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } });
				mockUploadFile.mockRejectedValueOnce(new Error("Azure upload timeout"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?.reason).toContain("Archive upload failed");
				expect(error?.reason).toContain("Azure upload timeout");
			});

			it("fails when FinalizeCacheEntryUpload returns non-ok HTTP status", async () => {
				queueReplies(
					{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
					{ status: 400 },
				);

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?.reason).toContain("FinalizeCacheEntryUpload failed");
				expect(error?.reason).toContain("HTTP 400");
			});

			it("fails when FinalizeCacheEntryUpload returns ok:false at HTTP 200", async () => {
				queueReplies(
					{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
					{ status: 200, body: { ok: false } },
				);

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "test-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?.reason).toContain("FinalizeCacheEntryUpload did not confirm success");
			});
		});
	});

	describe("retry schedule (regression guard)", () => {
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
		});

		afterEach(() => {
			vi.unstubAllEnvs();
			vi.clearAllMocks();
		});

		// The schedule is `exponential("3 seconds", 1.5) ∩ recurs(4)`, so retries
		// need TestClock to advance instantly.
		const runWithClock = <A, E>(effect: Effect.Effect<A, E, ActionCache>) =>
			Effect.gen(function* () {
				const fiber = yield* Effect.fork(Effect.provide(effect, liveLayer));
				yield* TestClock.adjust(Duration.seconds(120));
				return yield* Fiber.join(fiber);
			}).pipe(Effect.exit, Effect.provide(TestContext.TestContext), Effect.runPromise);

		it("retries Twirp calls on HTTP 503 then succeeds", async () => {
			// CreateCacheEntry: 503, 503, then 200 — must succeed after retries.
			queueReplies(
				{ status: 503 },
				{ status: 503 },
				{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
				{ status: 200, body: { ok: true, entry_id: "entry-1" } },
			);

			const exit = await runWithClock(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "retry-key")));

			expect(exit._tag).toBe("Success");
			// 2 failed CreateCacheEntry + 1 success + 1 finalize.
			expect(twirpCaptured).toHaveLength(4);
		});

		it("retries Twirp calls on an ECONNRESET transport fault then succeeds", async () => {
			queueReplies(
				{ status: 0, transportError: "read ECONNRESET" },
				{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
				{ status: 200, body: { ok: true, entry_id: "entry-1" } },
			);

			const exit = await runWithClock(
				Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "econnreset-key")),
			);

			expect(exit._tag).toBe("Success");
			expect(twirpCaptured).toHaveLength(3);
		});

		it("gives up after exhausting the retry budget on persistent 503", async () => {
			// Always 503: 1 initial + 4 recurs = 5 attempts, then fail.
			queueReplies({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });

			const exit = await runWithClock(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules"], "always-503")));

			expect(exit._tag).toBe("Failure");
			const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
			expect(error?.reason).toContain("HTTP 503");
			expect(twirpCaptured).toHaveLength(5);
		});
	});

	describe("restore", () => {
		it("fails with ActionCacheError when env vars are missing", async () => {
			const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));
			expect(Exit.isFailure(exit)).toBe(true);
			const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
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
				queueReplies({ status: 200, body: { ok: false } });

				const exit = await runLiveExit(
					Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "missing-key")),
				);

				expect(Exit.isSuccess(exit)).toBe(true);
				if (Exit.isSuccess(exit)) {
					expect(Option.isNone(exit.value as Option.Option<string>)).toBe(true);
				}
			});

			it("returns Some with matched_key on cache hit", async () => {
				queueReplies({
					status: 200,
					body: {
						ok: true,
						signed_download_url: "https://azure.example.com/download",
						matched_key: "my-key-abc",
					},
				});

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
				if (Exit.isSuccess(exit)) {
					const result = exit.value as Option.Option<string>;
					expect(Option.isSome(result)).toBe(true);
					if (Option.isSome(result)) {
						expect(result.value).toBe("my-key-abc");
					}
				}
				expect(mockDownloadToFile).toHaveBeenCalled();
				const expectedFlags = process.platform === "win32" ? "xzPkf" : "xzPf";
				expect(mockedExecFileSync).toHaveBeenCalledWith(
					"tar",
					expect.arrayContaining([expectedFlags]),
					expect.any(Object),
				);
			});

			it("returns Some with primaryKey when response has no matched_key", async () => {
				queueReplies({
					status: 200,
					body: { ok: true, signed_download_url: "https://azure.example.com/download" },
				});

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
			});

			it("fails when GetCacheEntryDownloadURL returns non-ok HTTP status", async () => {
				queueReplies({ status: 400 });

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?.reason).toContain("GetCacheEntryDownloadURL failed");
				expect(error?.reason).toContain("HTTP 400");
			});

			it("fails when Azure download rejects", async () => {
				queueReplies({
					status: 200,
					body: { ok: true, signed_download_url: "https://azure.example.com/download", matched_key: "my-key" },
				});
				mockDownloadToFile.mockRejectedValueOnce(new Error("Azure download timeout"));

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?.reason).toContain("Archive download failed");
				expect(error?.reason).toContain("Azure download timeout");
			});

			it("tolerates tar exit code 1 (non-fatal file-exists warnings)", async () => {
				queueReplies({
					status: 200,
					body: { ok: true, signed_download_url: "https://azure.example.com/download", matched_key: "my-key" },
				});
				mockedExecFileSync.mockImplementation(() => {
					const err = new Error("tar: file exists, not overwritten") as Error & { status: number };
					err.status = 1;
					throw err;
				});

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isSuccess(exit)).toBe(true);
			});

			it("fails when tar extraction exits with code 2 (fatal error)", async () => {
				queueReplies({
					status: 200,
					body: { ok: true, signed_download_url: "https://azure.example.com/download", matched_key: "my-key" },
				});
				mockedExecFileSync.mockImplementation(() => {
					const err = new Error("tar: fatal error") as Error & { status: number };
					err.status = 2;
					throw err;
				});

				const exit = await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.restore(["node_modules"], "my-key")));

				expect(Exit.isFailure(exit)).toBe(true);
				const error = extractError(exit as Exit.Exit<unknown, ActionCacheError>);
				expect(error?.reason).toContain("Failed to extract archive");
			});

			it("sends restore_keys in the Twirp request body", async () => {
				queueReplies({ status: 200, body: { ok: false } });

				await runLiveExit(
					Effect.flatMap(ActionCache, (svc) =>
						svc.restore(["node_modules"], "primary-key", ["restore-key-1", "restore-key-2"]),
					),
				);

				const body = twirpCaptured[0]?.body as { key: string; restore_keys: string[] };
				expect(body.key).toBe("primary-key");
				expect(body.restore_keys).toEqual(["restore-key-1", "restore-key-2"]);
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

		queueReplies(
			{ status: 200, body: { ok: true, signed_upload_url: "https://azure.example.com/upload" } },
			{ status: 200, body: { ok: true } },
		);

		await runLiveExit(Effect.flatMap(ActionCache, (svc) => svc.save(["node_modules", ".cache"], "version-test-key")));

		const body = twirpCaptured[0]?.body as { version: string };
		const expectedVersion = computeVersion(["node_modules", ".cache"]);
		expect(body.version).toBe(expectedVersion);

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
	const run = <A, E>(state: ReturnType<typeof ActionCacheTest.empty>, effect: Effect.Effect<A, E, ActionCache>) =>
		Effect.runPromise(Effect.provide(effect, ActionCacheTest.layer(state)));

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
