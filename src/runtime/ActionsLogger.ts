import { HashMap, Inspectable, LogLevel, Logger, Option } from "effect";
import * as WorkflowCommand from "./WorkflowCommand.js";

/**
 * An Effect `Logger` that maps log levels to GitHub Actions workflow commands.
 *
 * - Debug / Trace  → `::debug::message`
 * - Info           → plain text to stdout (no command prefix)
 * - Warning        → `::warning::message`
 * - Error / Fatal  → `::error::message`
 *
 * Annotations `file`, `line`, and `col` are forwarded as workflow command
 * properties when present (e.g. `::error file=a.ts,line=1::message`).
 */
export const ActionsLogger: Logger.Logger<unknown, void> = Logger.make((options) => {
	// options.message is an Array of unknown values; join them into a single string
	const parts = Array.isArray(options.message) ? options.message : [options.message];
	const message = parts.map((p) => Inspectable.toStringUnknown(p)).join(" ");
	const level = options.logLevel;

	// Collect annotation properties: file, line, col
	const properties: Record<string, string> = {};
	for (const key of ["file", "line", "col"] as const) {
		const value = HashMap.get(options.annotations, key);
		if (Option.isSome(value)) {
			properties[key] = String(value.value);
		}
	}

	if (LogLevel.greaterThanEqual(level, LogLevel.Error)) {
		// Error and Fatal
		WorkflowCommand.issue("error", properties, message);
	} else if (LogLevel.greaterThanEqual(level, LogLevel.Warning)) {
		// Warning
		WorkflowCommand.issue("warning", properties, message);
	} else if (LogLevel.greaterThanEqual(level, LogLevel.Info)) {
		// Info — plain text, no workflow command prefix
		process.stdout.write(`${message}\n`);
	} else {
		// Debug and Trace
		WorkflowCommand.issue("debug", properties, message);
	}
});
