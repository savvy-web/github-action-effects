/**
 * \@savvy-web/github-action-effects
 *
 * Effect-based utility library for building robust, well-logged,
 * and schema-validated GitHub Actions.
 *
 * @packageDocumentation
 */

// -- Errors --
export { ActionInputError, ActionInputErrorBase } from "./errors/ActionInputError.js";
export { ActionOutputError, ActionOutputErrorBase } from "./errors/ActionOutputError.js";

// -- Layers --
export { ActionInputsLive } from "./layers/ActionInputsLive.js";
export { ActionInputsTest } from "./layers/ActionInputsTest.js";
export {
	ActionLoggerLayer,
	ActionLoggerLive,
	CurrentLogLevel,
	makeActionLogger,
	setLogLevel,
} from "./layers/ActionLoggerLive.js";
export { ActionLoggerTest, type ActionLoggerTestState } from "./layers/ActionLoggerTest.js";
export { ActionOutputsLive } from "./layers/ActionOutputsLive.js";
export { ActionOutputsTest, type ActionOutputsTestState } from "./layers/ActionOutputsTest.js";

// -- Schemas --
export { CapturedOutput, ChecklistItem, Status } from "./schemas/GithubMarkdown.js";
export { ActionLogLevel, LogLevelInput, resolveLogLevel } from "./schemas/LogLevel.js";

// -- Services --
export { ActionInputs } from "./services/ActionInputs.js";
export { ActionLogger } from "./services/ActionLogger.js";
export { ActionOutputs } from "./services/ActionOutputs.js";

// -- GFM Builders (pure functions) --
export {
	bold,
	checklist,
	code,
	codeBlock,
	details,
	heading,
	link,
	list,
	rule,
	statusIcon,
	table,
} from "./utils/GithubMarkdown.js";
