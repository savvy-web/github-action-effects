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
