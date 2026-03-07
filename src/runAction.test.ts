import * as core from "@actions/core";
import { Context, Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAction } from "./runAction.js";

vi.mock("@actions/core", () => ({
	getInput: vi.fn(() => ""),
	getMultilineInput: vi.fn(() => []),
	getBooleanInput: vi.fn(() => false),
	setSecret: vi.fn(),
	setOutput: vi.fn(),
	setFailed: vi.fn(),
	exportVariable: vi.fn(),
	addPath: vi.fn(),
	info: vi.fn(),
	debug: vi.fn(),
	warning: vi.fn(),
	error: vi.fn(),
	notice: vi.fn(),
	startGroup: vi.fn(),
	endGroup: vi.fn(),
	summary: {
		addRaw: vi.fn().mockReturnThis(),
		write: vi.fn().mockResolvedValue(undefined),
	},
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe("runAction", () => {
	it("runs a successful program without calling setFailed", async () => {
		runAction(Effect.void);
		await new Promise((r) => setTimeout(r, 10));
		expect(core.setFailed).not.toHaveBeenCalled();
	});

	it("calls setFailed on program failure", async () => {
		runAction(Effect.fail("something broke"));
		await new Promise((r) => setTimeout(r, 10));
		expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Action failed"));
	});

	it("accepts additional layers via options", async () => {
		interface MyService {
			readonly value: string;
		}
		const MyService = Context.GenericTag<MyService>("TestMyService");
		const MyServiceLive = Layer.succeed(MyService, { value: "hello" });

		const program = Effect.flatMap(MyService, (svc) =>
			Effect.sync(() => {
				expect(svc.value).toBe("hello");
			}),
		);

		runAction(program, MyServiceLive);
		await new Promise((r) => setTimeout(r, 10));
		expect(core.setFailed).not.toHaveBeenCalled();
	});
});
