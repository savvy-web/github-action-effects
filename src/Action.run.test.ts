import { Context, Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Action } from "./Action.js";

const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

afterEach(() => {
	vi.clearAllMocks();
	process.exitCode = undefined;
});

describe("Action.run", () => {
	it("runs a successful program without emitting an error command", async () => {
		await Action.run(Effect.void);
		const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
		expect(output).not.toContain("::error::");
		expect(process.exitCode).toBeUndefined();
	});

	it("emits ::error:: workflow command on program failure", async () => {
		await Action.run(Effect.fail("something broke"));
		const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
		expect(output).toContain("::error::");
		expect(output).toContain("Action failed");
		expect(process.exitCode).toBe(1);
	});

	it("includes stack trace in error output when Error is thrown", async () => {
		await Action.run(Effect.die(new Error("crash with stack")));
		const output = stdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
		expect(output).toContain("::error::");
		expect(output).toContain("crash with stack");
		expect(process.exitCode).toBe(1);
	});

	it("accepts additional layers via options", async () => {
		class MyService extends Context.Tag("TestMyService")<MyService, { readonly value: string }>() {}
		const MyServiceLive = Layer.succeed(MyService, { value: "hello" });

		const program = Effect.flatMap(MyService, (svc) =>
			Effect.sync(() => {
				expect(svc.value).toBe("hello");
			}),
		);

		await Action.run(program, { layer: MyServiceLive });
		expect(process.exitCode).toBeUndefined();
	});
});
