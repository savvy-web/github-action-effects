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
export { GitHubGraphQLError, GitHubGraphQLErrorBase } from "./errors/GitHubGraphQLError.js";
export { GitHubIssueError, GitHubIssueErrorBase } from "./errors/GitHubIssueError.js";
export { GitHubReleaseError, GitHubReleaseErrorBase } from "./errors/GitHubReleaseError.js";
export { GitTagError, GitTagErrorBase } from "./errors/GitTagError.js";
export { NpmRegistryError, NpmRegistryErrorBase } from "./errors/NpmRegistryError.js";
export { OtelExporterError, OtelExporterErrorBase } from "./errors/OtelExporterError.js";
export { PackageManagerError, PackageManagerErrorBase } from "./errors/PackageManagerError.js";
export { PackagePublishError, PackagePublishErrorBase } from "./errors/PackagePublishError.js";
export { PullRequestCommentError, PullRequestCommentErrorBase } from "./errors/PullRequestCommentError.js";
export { RateLimitError, RateLimitErrorBase } from "./errors/RateLimitError.js";
export { SemverResolverError, SemverResolverErrorBase } from "./errors/SemverResolverError.js";
export { TokenPermissionError, TokenPermissionErrorBase } from "./errors/TokenPermissionError.js";
export { ToolInstallerError, ToolInstallerErrorBase } from "./errors/ToolInstallerError.js";
export { WorkflowDispatchError, WorkflowDispatchErrorBase } from "./errors/WorkflowDispatchError.js";
export { WorkspaceDetectorError, WorkspaceDetectorErrorBase } from "./errors/WorkspaceDetectorError.js";
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
export { DryRunLive } from "./layers/DryRunLive.js";
export type { DryRunTestState } from "./layers/DryRunTest.js";
export { DryRunTest } from "./layers/DryRunTest.js";
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
export { GitHubGraphQLLive } from "./layers/GitHubGraphQLLive.js";
export type { GitHubGraphQLTestState } from "./layers/GitHubGraphQLTest.js";
export { GitHubGraphQLTest } from "./layers/GitHubGraphQLTest.js";
export { GitHubIssueLive } from "./layers/GitHubIssueLive.js";
export type { GitHubIssueTestState } from "./layers/GitHubIssueTest.js";
export { GitHubIssueTest } from "./layers/GitHubIssueTest.js";
export { GitHubReleaseLive } from "./layers/GitHubReleaseLive.js";
export type { GitHubReleaseTestState } from "./layers/GitHubReleaseTest.js";
export { GitHubReleaseTest } from "./layers/GitHubReleaseTest.js";
export { GitTagLive } from "./layers/GitTagLive.js";
export type { GitTagTestState } from "./layers/GitTagTest.js";
export { GitTagTest } from "./layers/GitTagTest.js";
export type { CompletedSpan } from "./layers/InMemoryTracer.js";
export { InMemoryTracer } from "./layers/InMemoryTracer.js";
export { NpmRegistryLive } from "./layers/NpmRegistryLive.js";
export type { NpmRegistryTestState } from "./layers/NpmRegistryTest.js";
export { NpmRegistryTest } from "./layers/NpmRegistryTest.js";
export { OtelExporterLive } from "./layers/OtelExporterLive.js";
export type { OtelConfig } from "./layers/OtelTelemetryLive.js";
export { OtelTelemetryLive } from "./layers/OtelTelemetryLive.js";
export { PackageManagerAdapterLive } from "./layers/PackageManagerAdapterLive.js";
export type { PackageManagerAdapterTestState } from "./layers/PackageManagerAdapterTest.js";
export { PackageManagerAdapterTest } from "./layers/PackageManagerAdapterTest.js";
export { PackagePublishLive } from "./layers/PackagePublishLive.js";
export type { PackagePublishTestState } from "./layers/PackagePublishTest.js";
export { PackagePublishTest } from "./layers/PackagePublishTest.js";
export { PullRequestCommentLive } from "./layers/PullRequestCommentLive.js";
export type { PullRequestCommentTestState } from "./layers/PullRequestCommentTest.js";
export { PullRequestCommentTest } from "./layers/PullRequestCommentTest.js";
export { RateLimiterLive } from "./layers/RateLimiterLive.js";
export type { RateLimiterTestState } from "./layers/RateLimiterTest.js";
export { RateLimiterTest } from "./layers/RateLimiterTest.js";
export { TokenPermissionCheckerLive } from "./layers/TokenPermissionCheckerLive.js";
export type { TokenPermissionCheckerTestState } from "./layers/TokenPermissionCheckerTest.js";
export { TokenPermissionCheckerTest } from "./layers/TokenPermissionCheckerTest.js";
export { ToolInstallerLive } from "./layers/ToolInstallerLive.js";
export type { ToolInstallerTestState } from "./layers/ToolInstallerTest.js";
export { ToolInstallerTest } from "./layers/ToolInstallerTest.js";
export { WorkflowDispatchLive } from "./layers/WorkflowDispatchLive.js";
export type { DispatchRecord, WorkflowDispatchTestState } from "./layers/WorkflowDispatchTest.js";
export { WorkflowDispatchTest } from "./layers/WorkflowDispatchTest.js";
export { WorkspaceDetectorLive } from "./layers/WorkspaceDetectorLive.js";
export type { WorkspaceDetectorTestState } from "./layers/WorkspaceDetectorTest.js";
export { WorkspaceDetectorTest } from "./layers/WorkspaceDetectorTest.js";
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
export type { NpmPackageInfo as NpmPackageInfoType } from "./schemas/NpmPackage.js";
export { NpmPackageInfo } from "./schemas/NpmPackage.js";
export type {
	OtelEnabled as OtelEnabledType,
	OtelProtocol as OtelProtocolType,
	ResolvedOtelConfig as ResolvedOtelConfigType,
} from "./schemas/OtelExporter.js";
export { OtelEnabled, OtelProtocol, parseOtelHeaders, resolveOtelConfig } from "./schemas/OtelExporter.js";
export type {
	PackageManagerInfo as PackageManagerInfoType,
	PackageManagerName as PackageManagerNameType,
} from "./schemas/PackageManager.js";
export { PackageManagerInfo, PackageManagerName } from "./schemas/PackageManager.js";
export type { RateLimitStatus as RateLimitStatusType } from "./schemas/RateLimit.js";
export { RateLimitStatus } from "./schemas/RateLimit.js";
export { MetricData } from "./schemas/Telemetry.js";
export type {
	ExtraPermission as ExtraPermissionType,
	PermissionCheckResult as PermissionCheckResultType,
	PermissionGap as PermissionGapType,
	PermissionLevel as PermissionLevelType,
} from "./schemas/TokenPermission.js";
export { ExtraPermission, PermissionCheckResult, PermissionGap, PermissionLevel } from "./schemas/TokenPermission.js";
export type {
	WorkspaceInfo as WorkspaceInfoType,
	WorkspacePackage as WorkspacePackageType,
	WorkspaceType as WorkspaceTypeType,
} from "./schemas/Workspace.js";
export { WorkspaceInfo, WorkspacePackage, WorkspaceType } from "./schemas/Workspace.js";
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
export { DryRun } from "./services/DryRun.js";
export { GitBranch } from "./services/GitBranch.js";
export { GitCommit } from "./services/GitCommit.js";
export type { InstallationToken as InstallationTokenType } from "./services/GitHubApp.js";
export { GitHubApp, InstallationToken } from "./services/GitHubApp.js";
export { GitHubClient } from "./services/GitHubClient.js";
export { GitHubGraphQL } from "./services/GitHubGraphQL.js";
export type { IssueData } from "./services/GitHubIssue.js";
export { GitHubIssue } from "./services/GitHubIssue.js";
export type { ReleaseAsset, ReleaseData } from "./services/GitHubRelease.js";
export { GitHubRelease } from "./services/GitHubRelease.js";
export type { TagRef } from "./services/GitTag.js";
export { GitTag } from "./services/GitTag.js";
export { NpmRegistry } from "./services/NpmRegistry.js";
export type { InstallOptions } from "./services/PackageManagerAdapter.js";
export { PackageManagerAdapter } from "./services/PackageManagerAdapter.js";
export type { PackResult, RegistryTarget } from "./services/PackagePublish.js";
export { PackagePublish } from "./services/PackagePublish.js";
export type { CommentRecord } from "./services/PullRequestComment.js";
export { PullRequestComment } from "./services/PullRequestComment.js";
export { RateLimiter } from "./services/RateLimiter.js";
export { TokenPermissionChecker } from "./services/TokenPermissionChecker.js";
export type { ToolInstallOptions } from "./services/ToolInstaller.js";
export { ToolInstaller } from "./services/ToolInstaller.js";
export type { PollOptions, WorkflowRunStatus } from "./services/WorkflowDispatch.js";
export { WorkflowDispatch } from "./services/WorkflowDispatch.js";
export { WorkspaceDetector } from "./services/WorkspaceDetector.js";
export { AutoMerge } from "./utils/AutoMerge.js";
export type { AccumulateResult } from "./utils/ErrorAccumulator.js";
export { ErrorAccumulator } from "./utils/ErrorAccumulator.js";
export { GitHubOtelAttributes } from "./utils/GitHubOtelAttributes.js";
export { GithubMarkdown } from "./utils/GithubMarkdown.js";
export type { Report } from "./utils/ReportBuilder.js";
export { ReportBuilder } from "./utils/ReportBuilder.js";
export { SemverResolver } from "./utils/SemverResolver.js";
export type { SpanSummary } from "./utils/TelemetryReport.js";
export { TelemetryReport } from "./utils/TelemetryReport.js";
