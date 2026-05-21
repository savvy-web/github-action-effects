import { FiberRef, Inspectable, LogLevel, Logger } from "effect";
import * as WorkflowCommand from "./WorkflowCommand.js";

/**
 * Internal mechanics for the {@link "./Step.js" | Step} primitive — the
 * mutable buffer object, the FiberRef-tracked step stack, and the
 * helpers that render buffered output.
 *
 * Not part of the public API. Re-exported only through the `Step.*`
 * namespace facade.
 *
 * @internal
 */

/**
 * Mutable per-step buffer object. One instance is created per
 * `withStep` invocation and closed over by the step's buffering
 * logger. The buffer is discarded on the step's success and flushed
 * to stdout on failure.
 *
 * The `entries` array is `push`ed in place by the buffering logger
 * (synchronous, runs inside `Logger.make`'s callback). Since each
 * `withStep` creates its own buffer object, concurrent siblings never
 * share state.
 *
 * @internal
 */
export interface StepBuffer {
	readonly entries: Array<BufferedLine>;
}

/**
 * One buffered log line.
 *
 * @internal
 */
export interface BufferedLine {
	readonly level: "debug" | "info";
	readonly text: string;
	readonly timestamp: number;
}

/**
 * One frame on the active step stack.
 *
 * `successLine` and `failureLine` are the mutable fields. `successLine`
 * is set by {@link "./Step.js".success}; `failureLine` by
 * {@link "./Step.js".failure}. Both are read by
 * {@link "./Step.js".withStep} after the body resolves — when
 * `failureLine` is set the step renders its `❌` block even though the
 * wrapped effect succeeded, letting a loop record a non-fatal failure
 * without throwing.
 *
 * `buffer` is the step's debug buffer — held on the frame rather than
 * in a separate FiberRef so the parent step can read the child's
 * spill if the child fails.
 *
 * @internal
 */
export interface StepFrame {
	readonly name: string;
	readonly depth: number;
	successLine: string | null;
	failureLine: string | null;
	readonly buffer: StepBuffer;
}

/**
 * Stack of active steps in the current fiber. Outermost first; newest
 * pushed onto the end. Empty when no `withStep` is active.
 *
 * `FiberRef.unsafeMake` is the only constructor that returns a
 * `FiberRef` directly (not an `Effect`) so this module-level state
 * can be exported without entering a Scope. The ref is forked per
 * `Effect.fork`, so concurrent steps don't pollute each other's
 * stacks.
 *
 * @internal
 */
export const StepStack: FiberRef.FiberRef<ReadonlyArray<StepFrame>> = FiberRef.unsafeMake<ReadonlyArray<StepFrame>>([]);

/**
 * Convert any `Effect.log*` payload into a flat string. Mirrors the
 * normalisation in {@link "./ActionsLogger.js".ActionsLogger}.
 *
 * @internal
 */
export const formatMessage = (message: unknown): string => {
	const parts = Array.isArray(message) ? message : [message];
	return parts.map((p) => Inspectable.toStringUnknown(p)).join(" ");
};

/**
 * Pass-through emission — what `ActionsLogger` does for the matching
 * level, but called directly so we don't loop through the logger that
 * invoked us.
 *
 * Used when no `withStep` is active OR for warning/error levels that
 * always pass through.
 *
 * @internal
 */
export const emitPassThrough = (logLevel: LogLevel.LogLevel, text: string): void => {
	if (LogLevel.greaterThanEqual(logLevel, LogLevel.Error)) {
		WorkflowCommand.issue("error", {}, text);
	} else if (LogLevel.greaterThanEqual(logLevel, LogLevel.Warning)) {
		WorkflowCommand.issue("warning", {}, text);
	} else if (LogLevel.greaterThanEqual(logLevel, LogLevel.Info)) {
		process.stdout.write(`${text}\n`);
	} else {
		WorkflowCommand.issue("debug", {}, text);
	}
};

/**
 * Build the logger installed for the duration of one `withStep`. The
 * buffer is the step's own mutable `StepBuffer`; the logger closes
 * over it and pushes debug/info entries directly while letting
 * warnings and errors pass through to the GitHub Actions workflow
 * commands.
 *
 * The logger's behaviour table:
 *
 * - **Warning / Error / Fatal** — always pass through. They map to
 *   GitHub Actions annotations whose UI affordance would be lost if
 *   buffered.
 * - **Info / Debug** — pushed into the step's `buffer.entries` array.
 *   On success the buffer is dropped by `withStep`; on failure it is
 *   spilled to stdout with `│ [DEBUG]` / `│ [INFO]` indentation.
 *
 * @internal
 */
export const makeStepBufferingLogger = (buffer: StepBuffer): Logger.Logger<unknown, void> =>
	Logger.make(({ logLevel, message }) => {
		const text = formatMessage(message);

		// Warnings and errors are pass-through even inside a step.
		if (LogLevel.greaterThanEqual(logLevel, LogLevel.Warning)) {
			emitPassThrough(logLevel, text);
			return;
		}

		const level: BufferedLine["level"] = LogLevel.greaterThanEqual(logLevel, LogLevel.Info) ? "info" : "debug";
		buffer.entries.push({ level, text, timestamp: Date.now() });
	});

/**
 * Indent rendering — `"  "` per depth. Used both for live success
 * lines and for failure spill prefixes.
 *
 * @internal
 */
export const indent = (depth: number): string => "  ".repeat(depth);

/**
 * Emit the success summary line for a step. Called from `withStep`
 * after the wrapped effect resolves successfully.
 *
 * Format:
 *
 * - When `line` is non-null and non-empty → `<indent>✅ <name>: <line>`.
 * - When `line` is `null` or empty → `<indent>✅ <name>` (bare fallback).
 *
 * The library is the single source of truth for the `✅ <name>:`
 * prefix. Consumers passing a line through `Step.success` should
 * provide ONLY the outcome — not the step name and not the icon.
 *
 * @internal
 */
export const emitSuccess = (frame: StepFrame, line: string | null): void => {
	const prefix = indent(frame.depth);
	if (line !== null && line.length > 0) {
		process.stdout.write(`${prefix}✅ ${frame.name}: ${line}\n`);
	} else {
		process.stdout.write(`${prefix}✅ ${frame.name}\n`);
	}
};

/**
 * Emit the failure block for a step. Writes the failure header, then
 * each buffered line with a `│ [LEVEL]` prefix, then — only when there
 * were buffered lines — a trailing `└ Error:` line that closes the spill
 * block.
 *
 * The spill is written **directly to stdout** at the child's depth.
 * The parent step's buffer is not modified — its failure block (if
 * the parent also fails) will appear above this one in chronological
 * order because of standard streaming output.
 *
 * Failure header format mirrors the success path: `❌ <name>: <error>`.
 * The library prepends the icon and step name; callers' error
 * messages should describe the outcome only. When the buffer is empty
 * the `└ Error:` trailer is suppressed — with no spill lines to close,
 * it would just repeat the header's error text on the next line.
 *
 * @internal
 */
export const emitFailure = (frame: StepFrame, errorText: string): void => {
	const prefix = indent(frame.depth);
	process.stdout.write(`${prefix}❌ ${frame.name}: ${errorText}\n`);
	for (const entry of frame.buffer.entries) {
		const label = entry.level === "debug" ? "[DEBUG]" : "[INFO]";
		process.stdout.write(`${prefix}   │ ${label} ${entry.text}\n`);
	}
	if (frame.buffer.entries.length > 0) {
		process.stdout.write(`${prefix}   └ Error: ${errorText}\n`);
	}
};
