/**
 * Utilities for formatting GitHub Actions workflow commands.
 *
 * Workflow commands follow the protocol: `::command key=value,key=value::message`
 *
 * @see https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions
 */

/**
 * Escapes message content for use in workflow command data.
 * Encodes `%`, `\r`, and `\n`.
 */
export function escapeData(value: string): string {
	return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Escapes a property value for use in workflow command properties.
 * Encodes `%`, `\r`, `\n`, `:`, and `,`.
 */
export function escapeProperty(value: string): string {
	return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * Formats a workflow command string.
 *
 * @param command - The command name (e.g. "debug", "error", "group")
 * @param properties - Key/value pairs to include as command properties
 * @param message - The command message (data section)
 * @returns Formatted workflow command string
 */
export function format(command: string, properties: Record<string, string>, message: string): string {
	const propertiesEntries = Object.entries(properties);
	const propertiesPart =
		propertiesEntries.length > 0 ? ` ${propertiesEntries.map(([k, v]) => `${k}=${escapeProperty(v)}`).join(",")}` : "";
	return `::${command}${propertiesPart}::${escapeData(message)}`;
}

/**
 * Issues a workflow command by writing it to `process.stdout`.
 *
 * @param command - The command name
 * @param properties - Key/value pairs to include as command properties
 * @param message - The command message
 */
export function issue(command: string, properties: Record<string, string>, message: string): void {
	process.stdout.write(`${format(command, properties, message)}\n`);
}

/**
 * GitHub annotation properties shared by `::notice::`, `::warning::`, and
 * `::error::` commands. Matches `@actions/core` `AnnotationProperties`.
 *
 * @public
 */
export interface AnnotationProperties {
	/** A title for the annotation. */
	readonly title?: string;
	/** The path of the file the annotation should be attached to. */
	readonly file?: string;
	/** The start line for the annotation. */
	readonly startLine?: number;
	/** The end line for the annotation. */
	readonly endLine?: number;
	/** The start column for the annotation. Cannot span multiple lines. */
	readonly startColumn?: number;
	/** The end column for the annotation. Cannot span multiple lines. */
	readonly endColumn?: number;
}

/**
 * Maps {@link AnnotationProperties} to workflow-command properties, matching
 * `@actions/core` `toCommandProperties`: `startLine`→`line`,
 * `startColumn`→`col`, `endLine`→`endLine`, `endColumn`→`endColumn`. Absent
 * fields are omitted so an empty input yields an empty object.
 */
export function annotationProperties(properties: AnnotationProperties): Record<string, string> {
	const result: Record<string, string> = {};
	if (properties.title !== undefined) result.title = properties.title;
	if (properties.file !== undefined) result.file = properties.file;
	if (properties.startLine !== undefined) result.line = String(properties.startLine);
	if (properties.endLine !== undefined) result.endLine = String(properties.endLine);
	if (properties.startColumn !== undefined) result.col = String(properties.startColumn);
	if (properties.endColumn !== undefined) result.endColumn = String(properties.endColumn);
	return result;
}

/**
 * Issues a `::notice::` annotation. Matches `@actions/core.notice`.
 *
 * @param properties - Annotation properties (title/file/line/col, etc.)
 * @param message - The notice message
 */
export function notice(properties: AnnotationProperties, message: string): void {
	issue("notice", annotationProperties(properties), message);
}

/**
 * Suspends processing of workflow commands until {@link resumeCommands} is
 * called with the same token. Emits `::stop-commands::{token}`.
 *
 * @param token - A randomly generated, run-unique token.
 */
export function stopCommands(token: string): void {
	issue("stop-commands", {}, token);
}

/**
 * Resumes processing of workflow commands suspended by {@link stopCommands}.
 * Emits `::{token}::`.
 *
 * @param token - The token previously passed to {@link stopCommands}.
 */
export function resumeCommands(token: string): void {
	issue(token, {}, "");
}

/**
 * Enables or disables echoing of workflow commands. Emits `::echo::on` or
 * `::echo::off`. Matches `@actions/core.setCommandEcho`.
 */
export function setCommandEcho(enabled: boolean): void {
	issue("echo", {}, enabled ? "on" : "off");
}
