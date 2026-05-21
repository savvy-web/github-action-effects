import { HttpClient, HttpClientError, HttpClientResponse } from "@effect/platform";
import { Data, Duration, Effect, Exit, Fiber, Layer, Redacted, TestClock, TestContext } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import { CONFLICT, makeTwirpRetrySchedule, twirpCall } from "./twirp.js";

// ---------------------------------------------------------------------------
// Test error type (twirp.ts is generic over the error channel)
// ---------------------------------------------------------------------------

class TestError extends Data.TaggedError("TestError")<{ readonly reason: string }> {}

const onError = (reason: string): TestError => new TestError({ reason });

// ---------------------------------------------------------------------------
// Mock HttpClient (same shape ActionCacheLive.test.ts uses)
// ---------------------------------------------------------------------------

interface Reply {
	readonly status: number;
	readonly body?: unknown;
	readonly transportError?: string;
}

interface Captured {
	readonly url: string;
	readonly body: unknown;
	readonly headers: Record<string, string>;
}

let replies: Array<Reply> = [];
let captured: Array<Captured> = [];

const mockHttp: Layer.Layer<HttpClient.HttpClient> = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request, url) =>
		Effect.gen(function* () {
			const headers: Record<string, string> = {};
			for (const [k, v] of Object.entries(request.headers)) {
				if (typeof v === "string") headers[k.toLowerCase()] = v;
			}
			const bodyText = yield* Effect.promise(async () => {
				const b = request.body as { body?: unknown };
				if (b && typeof b === "object" && "body" in b && b.body instanceof Uint8Array) {
					return new TextDecoder().decode(b.body);
				}
				return "";
			});
			const parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
			captured.push({ url: url.toString(), body: parsedBody, headers });

			const reply = replies.shift() ?? { status: 500 };
			if (reply.transportError !== undefined) {
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

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, mockHttp)));

beforeEach(() => {
	replies = [];
	captured = [];
});

const call = <T>(method: string, body: Record<string, unknown> = {}) =>
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;
		return yield* twirpCall<T, TestError>(
			http,
			"https://results.example.com/",
			"github.actions.results.api.v1.ArtifactService",
			Redacted.make("test-token"),
			method,
			body,
			onError,
		);
	});

describe("twirpCall", () => {
	it("posts to /twirp/<service>/<method> with bearer auth", async () => {
		replies = [{ status: 200, body: { ok: true } }];
		const exit = await run(call("CreateArtifact", { name: "x" }));
		expect(Exit.isSuccess(exit)).toBe(true);
		expect(captured[0]?.url).toContain("twirp/github.actions.results.api.v1.ArtifactService/CreateArtifact");
		expect(captured[0]?.headers.authorization).toBe("Bearer test-token");
		expect(captured[0]?.body).toMatchObject({ name: "x" });
		// The runtime token must not leak into the request body.
		expect(JSON.stringify(captured[0]?.body)).not.toContain("test-token");
	});

	it("returns the CONFLICT sentinel on HTTP 409", async () => {
		replies = [{ status: 409 }];
		const exit = await run(call("CreateArtifact"));
		expect(Exit.isSuccess(exit)).toBe(true);
		if (Exit.isSuccess(exit)) {
			expect(exit.value).toBe(CONFLICT);
		}
	});

	it("fails on a non-ok status, preserving the `HTTP <status>` substring", async () => {
		replies = [{ status: 400 }];
		const exit = await run(call("ListArtifacts"));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const reason = (exit.cause as { error?: TestError }).error?.reason ?? "";
			expect(reason).toContain("ListArtifacts failed");
			expect(reason).toContain("HTTP 400");
		}
	});

	it("preserves the transport-fault message (ECONNRESET) for the retry schedule", async () => {
		replies = [{ status: 0, transportError: "read ECONNRESET" }];
		const exit = await run(call("ListArtifacts"));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const reason = (exit.cause as { error?: TestError }).error?.reason ?? "";
			expect(reason).toContain("ListArtifacts failed");
			expect(reason).toContain("ECONNRESET");
		}
	});
});

describe("makeTwirpRetrySchedule", () => {
	const retryingCall = (method: string) =>
		call(method).pipe(Effect.retry(makeTwirpRetrySchedule((e: TestError) => e.reason)));

	const runWithClock = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
		Effect.gen(function* () {
			const fiber = yield* Effect.fork(Effect.provide(effect, mockHttp));
			yield* TestClock.adjust(Duration.seconds(120));
			return yield* Fiber.join(fiber);
		}).pipe(Effect.exit, Effect.provide(TestContext.TestContext), Effect.runPromise);

	it("retries on HTTP 503 then succeeds", async () => {
		replies = [{ status: 503 }, { status: 503 }, { status: 200, body: { ok: true } }];
		const exit = await runWithClock(retryingCall("CreateArtifact"));
		expect(exit._tag).toBe("Success");
		expect(captured).toHaveLength(3);
	});

	it("gives up after exhausting the retry budget on persistent 503", async () => {
		replies = [{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }];
		const exit = await runWithClock(retryingCall("CreateArtifact"));
		expect(exit._tag).toBe("Failure");
		expect(captured).toHaveLength(5);
	});
});
