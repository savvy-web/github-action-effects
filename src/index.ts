/**
 * \@savvy-web/github-action-effects
 *
 * Effect-based utility library for building robust, well-logged,
 * and schema-validated GitHub Actions.
 *
 * @packageDocumentation
 */

export type { CoreServices, InputConfig, ParsedInputs } from "./Action.js";
// -- Namespaces --
export { Action } from "./Action.js";
// -- Errors --
export { ActionCacheError, ActionCacheErrorBase } from "./errors/ActionCacheError.js";
export { ActionEnvironmentError, ActionEnvironmentErrorBase } from "./errors/ActionEnvironmentError.js";
export { ActionInputError, ActionInputErrorBase } from "./errors/ActionInputError.js";
export { ActionOutputError, ActionOutputErrorBase } from "./errors/ActionOutputError.js";
export { ActionStateError, ActionStateErrorBase } from "./errors/ActionStateError.js";
export { ChangesetError, ChangesetErrorBase } from "./errors/ChangesetError.js";
export { CheckRunError, CheckRunErrorBase } from "./errors/CheckRunError.js";
export { CommandRunnerError, CommandRunnerErrorBase } from "./errors/CommandRunnerError.js";
export { ConfigLoaderError, ConfigLoaderErrorBase } from "./errors/ConfigLoaderError.js";
export { GitBranchError, GitBranchErrorBase } from "./errors/GitBranchError.js";
export { GitCommitError, GitCommitErrorBase } from "./errors/GitCommitError.js";
export { GitHubAppError, GitHubAppErrorBase } from "./errors/GitHubAppError.js";
export { GitHubClientError, GitHubClientErrorBase } from "./errors/GitHubClientError.js";
export { PackageManagerError, PackageManagerErrorBase } from "./errors/PackageManagerError.js";
export { PullRequestCommentError, PullRequestCommentErrorBase } from "./errors/PullRequestCommentError.js";
export { RateLimitError, RateLimitErrorBase } from "./errors/RateLimitError.js";
export { ToolInstallerError, ToolInstallerErrorBase } from "./errors/ToolInstallerError.js";
export { WorkflowDispatchError, WorkflowDispatchErrorBase } from "./errors/WorkflowDispatchError.js";
// -- Layers --
export { ActionCacheLive } from "./layers/ActionCacheLive.js";
export type { ActionCacheTestState } from "./layers/ActionCacheTest.js";
export { ActionCacheTest } from "./layers/ActionCacheTest.js";
export { ActionEnvironmentLive } from "./layers/ActionEnvironmentLive.js";
export { ActionEnvironmentTest } from "./layers/ActionEnvironmentTest.js";
export { ActionInputsLive } from "./layers/ActionInputsLive.js";
export { ActionInputsTest } from "./layers/ActionInputsTest.js";
export { ActionLoggerLayer, ActionLoggerLive, CurrentLogLevel } from "./layers/ActionLoggerLive.js";
export type { ActionLoggerTestState, TestAnnotationType } from "./layers/ActionLoggerTest.js";
export { ActionLoggerTest } from "./layers/ActionLoggerTest.js";
export { ActionOutputsLive } from "./layers/ActionOutputsLive.js";
export type { ActionOutputsTestState } from "./layers/ActionOutputsTest.js";
export { ActionOutputsTest } from "./layers/ActionOutputsTest.js";
export { ActionStateLive } from "./layers/ActionStateLive.js";
export type { ActionStateTestState } from "./layers/ActionStateTest.js";
export { ActionStateTest } from "./layers/ActionStateTest.js";
export { ActionTelemetryLive } from "./layers/ActionTelemetryLive.js";
export type { ActionTelemetryTestState } from "./layers/ActionTelemetryTest.js";
export { ActionTelemetryTest } from "./layers/ActionTelemetryTest.js";
export { ChangesetAnalyzerLive } from "./layers/ChangesetAnalyzerLive.js";
export type { ChangesetAnalyzerTestState } from "./layers/ChangesetAnalyzerTest.js";
export { ChangesetAnalyzerTest } from "./layers/ChangesetAnalyzerTest.js";
export { CheckRunLive } from "./layers/CheckRunLive.js";
export type { CheckRunRecord, CheckRunTestState } from "./layers/CheckRunTest.js";
export { CheckRunTest } from "./layers/CheckRunTest.js";
export { CommandRunnerLive } from "./layers/CommandRunnerLive.js";
export type { CommandResponse } from "./layers/CommandRunnerTest.js";
export { CommandRunnerTest } from "./layers/CommandRunnerTest.js";
export { ConfigLoaderLive } from "./layers/ConfigLoaderLive.js";
export type { ConfigLoaderTestState } from "./layers/ConfigLoaderTest.js";
export { ConfigLoaderTest } from "./layers/ConfigLoaderTest.js";
export { GitBranchLive } from "./layers/GitBranchLive.js";
export type { GitBranchTestState } from "./layers/GitBranchTest.js";
export { GitBranchTest } from "./layers/GitBranchTest.js";
export { GitCommitLive } from "./layers/GitCommitLive.js";
export type { GitCommitTestState } from "./layers/GitCommitTest.js";
export { GitCommitTest } from "./layers/GitCommitTest.js";
export { GitHubAppLive } from "./layers/GitHubAppLive.js";
export type { GitHubAppTestState } from "./layers/GitHubAppTest.js";
export { GitHubAppTest } from "./layers/GitHubAppTest.js";
export { GitHubClientLive } from "./layers/GitHubClientLive.js";
export type { GitHubClientTestState, RestResponse } from "./layers/GitHubClientTest.js";
export { GitHubClientTest } from "./layers/GitHubClientTest.js";
export type { CompletedSpan } from "./layers/InMemoryTracer.js";
export { InMemoryTracer } from "./layers/InMemoryTracer.js";
export type { OtelConfig } from "./layers/OtelTelemetryLive.js";
export { OtelTelemetryLive } from "./layers/OtelTelemetryLive.js";
export { PackageManagerAdapterLive } from "./layers/PackageManagerAdapterLive.js";
export type { PackageManagerAdapterTestState } from "./layers/PackageManagerAdapterTest.js";
export { PackageManagerAdapterTest } from "./layers/PackageManagerAdapterTest.js";
export { PullRequestCommentLive } from "./layers/PullRequestCommentLive.js";
export type { PullRequestCommentTestState } from "./layers/PullRequestCommentTest.js";
export { PullRequestCommentTest } from "./layers/PullRequestCommentTest.js";
export { RateLimiterLive } from "./layers/RateLimiterLive.js";
export type { RateLimiterTestState } from "./layers/RateLimiterTest.js";
export { RateLimiterTest } from "./layers/RateLimiterTest.js";
export { ToolInstallerLive } from "./layers/ToolInstallerLive.js";
export type { ToolInstallerTestState } from "./layers/ToolInstallerTest.js";
export { ToolInstallerTest } from "./layers/ToolInstallerTest.js";
export { WorkflowDispatchLive } from "./layers/WorkflowDispatchLive.js";
export type { DispatchRecord, WorkflowDispatchTestState } from "./layers/WorkflowDispatchTest.js";
export { WorkflowDispatchTest } from "./layers/WorkflowDispatchTest.js";
export type {
	BumpType as BumpTypeType,
	Changeset as ChangesetType,
	ChangesetFile as ChangesetFileType,
} from "./schemas/Changeset.js";
export { BumpType, Changeset, ChangesetFile } from "./schemas/Changeset.js";
export type { GitHubContext as GitHubContextType, RunnerContext as RunnerContextType } from "./schemas/Environment.js";
// -- Schemas --
export { GitHubContext, RunnerContext } from "./schemas/Environment.js";
export { CapturedOutput, ChecklistItem, Status } from "./schemas/GithubMarkdown.js";
export type { FileChange as FileChangeType, TreeEntry as TreeEntryType } from "./schemas/GitTree.js";
export { FileChange, TreeEntry } from "./schemas/GitTree.js";
export { ActionLogLevel, LogLevelInput } from "./schemas/LogLevel.js";
export type {
	PackageManagerInfo as PackageManagerInfoType,
	PackageManagerName as PackageManagerNameType,
} from "./schemas/PackageManager.js";
export { PackageManagerInfo, PackageManagerName } from "./schemas/PackageManager.js";
export type { RateLimitStatus as RateLimitStatusType } from "./schemas/RateLimit.js";
export { RateLimitStatus } from "./schemas/RateLimit.js";
export { MetricData } from "./schemas/Telemetry.js";
// -- Services --
export type { CacheHit } from "./services/ActionCache.js";
export { ActionCache } from "./services/ActionCache.js";
export { ActionEnvironment } from "./services/ActionEnvironment.js";
export { ActionInputs } from "./services/ActionInputs.js";
export { ActionLogger } from "./services/ActionLogger.js";
export { ActionOutputs } from "./services/ActionOutputs.js";
export { ActionState } from "./services/ActionState.js";
export { ActionTelemetry } from "./services/ActionTelemetry.js";
export { ChangesetAnalyzer } from "./services/ChangesetAnalyzer.js";
export type { AnnotationLevel, CheckRunAnnotation, CheckRunConclusion, CheckRunOutput } from "./services/CheckRun.js";
export { CheckRun } from "./services/CheckRun.js";
export type { ExecOptions, ExecOutput } from "./services/CommandRunner.js";
export { CommandRunner } from "./services/CommandRunner.js";
export { ConfigLoader } from "./services/ConfigLoader.js";
export { GitBranch } from "./services/GitBranch.js";
export { GitCommit } from "./services/GitCommit.js";
export type { InstallationToken as InstallationTokenType } from "./services/GitHubApp.js";
export { GitHubApp, InstallationToken } from "./services/GitHubApp.js";
export { GitHubClient } from "./services/GitHubClient.js";
export type { InstallOptions } from "./services/PackageManagerAdapter.js";
export { PackageManagerAdapter } from "./services/PackageManagerAdapter.js";
export type { CommentRecord } from "./services/PullRequestComment.js";
export { PullRequestComment } from "./services/PullRequestComment.js";
export { RateLimiter } from "./services/RateLimiter.js";
export type { ToolInstallOptions } from "./services/ToolInstaller.js";
export { ToolInstaller } from "./services/ToolInstaller.js";
export type { PollOptions, WorkflowRunStatus } from "./services/WorkflowDispatch.js";
export { WorkflowDispatch } from "./services/WorkflowDispatch.js";
export { GithubMarkdown } from "./utils/GithubMarkdown.js";
export type { Report } from "./utils/ReportBuilder.js";
export { ReportBuilder } from "./utils/ReportBuilder.js";
export type { SpanSummary } from "./utils/TelemetryReport.js";
export { TelemetryReport } from "./utils/TelemetryReport.js";
