# Common Patterns

This guide covers common patterns when building GitHub Actions with
`@savvy-web/github-action-effects`.

## Dry-Run Mode

The `DryRun` service intercepts mutation effects and returns fallback values
when dry-run is enabled.

```typescript
import { Effect, Schema } from "effect";
import {
  Action,
  DryRun,
  DryRunLive,
  GitHubRelease,
  GitHubReleaseLive,
} from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const dryRun = yield* DryRun;
  const releases = yield* GitHubRelease;

  const isDry = yield* dryRun.isDryRun;
  yield* Effect.log(`Dry-run: ${isDry}`);

  // In dry-run mode, the release.create call is skipped
  // and the fallback value is returned instead
  const release = yield* dryRun.guard(
    "create-release",
    releases.create({
      tag: "v1.0.0",
      name: "v1.0.0",
      body: "Release notes",
    }),
    { id: 0, tag: "v1.0.0", name: "v1.0.0", body: "", draft: false, prerelease: false, uploadUrl: "" },
  );
});

Action.run(program, Layer.mergeAll(DryRunLive, GitHubReleaseLive));
```

The `DryRunLive` layer reads a `dry-run` input (or environment variable) to
determine the mode. Add `dry-run` to your `action.yml` inputs.

## Error Accumulation

The `ErrorAccumulator` namespace processes all items without short-circuiting
on first error, collecting both successes and failures.

```typescript
import { Effect } from "effect";
import { ErrorAccumulator } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const packages = ["pkg-a", "pkg-b", "pkg-c"];

  const result = yield* ErrorAccumulator.forEachAccumulate(
    packages,
    (pkg) => publishPackage(pkg), // may fail for some packages
  );

  yield* Effect.log(`Published: ${result.successes.length}`);
  yield* Effect.log(`Failed: ${result.failures.length}`);

  // Report all failures
  for (const { item, error } of result.failures) {
    yield* Effect.logError(`Failed to publish ${item}: ${error}`);
  }
});
```

For concurrent processing with controlled parallelism:

```typescript
const result = yield* ErrorAccumulator.forEachAccumulateConcurrent(
  packages,
  (pkg) => publishPackage(pkg),
  4, // max 4 concurrent
);
```

## Permission Checking

Verify GitHub token permissions before attempting operations that require
specific scopes.

```typescript
import { Effect } from "effect";
import {
  TokenPermissionChecker,
  TokenPermissionCheckerLive,
} from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const checker = yield* TokenPermissionChecker;

  // Fail early if permissions are missing
  yield* checker.assertSufficient({
    contents: "write",
    "pull-requests": "write",
    checks: "write",
  });

  // Or fail if there are missing OR extra permissions (least-privilege)
  yield* checker.assertExact({
    contents: "read",
  });

  // Or just warn without failing
  yield* checker.warnOverPermissioned({
    contents: "read",
  });

  // Or check and handle the result yourself
  const result = yield* checker.check({
    contents: "write",
  });
  // result.sufficient: boolean
  // result.gaps: Array<{ scope, required, granted }>
  // result.extras: Array<{ scope, granted }>
});
```

Add this to the beginning of your action to catch permission issues early
with a clear error message instead of cryptic API failures.

## Workspace Detection

Detect monorepo structure and iterate over packages.

```typescript
import { Effect } from "effect";
import {
  WorkspaceDetector,
  WorkspaceDetectorLive,
  ErrorAccumulator,
} from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const workspaces = yield* WorkspaceDetector;

  const info = yield* workspaces.detect();
  yield* Effect.log(`Workspace type: ${info.type}`);

  const packages = yield* workspaces.listPackages();

  // Process all packages, accumulating errors
  const result = yield* ErrorAccumulator.forEachAccumulate(
    packages,
    (pkg) => Effect.gen(function* () {
      yield* Effect.log(`Processing ${pkg.name}`);
      // ... build, test, publish
    }),
  );
});
```

## Package Publishing Workflow

A complete multi-registry publish workflow combining several services.

```typescript
import { Effect, Layer } from "effect";
import {
  Action,
  DryRun,
  DryRunLive,
  NpmRegistry,
  NpmRegistryLive,
  PackagePublish,
  PackagePublishLive,
  TokenPermissionChecker,
  TokenPermissionCheckerLive,
  ErrorAccumulator,
  GithubMarkdown,
  ActionOutputs,
} from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const dryRun = yield* DryRun;
  const checker = yield* TokenPermissionChecker;
  const npm = yield* NpmRegistry;
  const publisher = yield* PackagePublish;
  const outputs = yield* ActionOutputs;

  // 1. Verify permissions
  yield* checker.assertSufficient({ contents: "write" });

  // 2. Check if version already exists
  const latest = yield* npm.getLatestVersion("@scope/my-pkg");
  yield* Effect.log(`Current latest: ${latest}`);

  // 3. Pack and publish
  const packed = yield* dryRun.guard(
    "pack",
    publisher.pack("./dist/npm"),
    { tarball: "dry-run.tgz", digest: "sha512-dry" },
  );

  yield* dryRun.guard(
    "publish",
    publisher.publishToRegistries("./dist/npm", [
      { registry: "https://registry.npmjs.org/", token: npmToken },
      { registry: "https://npm.pkg.github.com/", token: ghToken },
    ]),
    undefined,
  );

  // 4. Write summary
  yield* outputs.summary(
    GithubMarkdown.table(
      ["Package", "Version", "Status"],
      [["@scope/my-pkg", "1.0.0", GithubMarkdown.statusIcon("pass")]],
    ),
  );
});

Action.run(
  program,
  Layer.mergeAll(
    DryRunLive,
    NpmRegistryLive,
    PackagePublishLive,
    TokenPermissionCheckerLive,
  ),
);
```

## Report Builder

The `ReportBuilder` creates structured markdown reports that can be sent to
step summaries, PR comments, or check runs.

```typescript
import { Effect } from "effect";
import { ReportBuilder, ActionOutputs } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const report = ReportBuilder.create("Build Report")
    .stat("Duration", "1.5s")
    .stat("Packages", 12)
    .stat("Tests Passed", "142/142")
    .section("Details", "All packages compiled successfully.")
    .details("Full Log", longLogOutput);

  // Write to step summary
  yield* report.toSummary();

  // Or upsert as a PR comment
  yield* report.toComment(prNumber, "build-report");

  // Or set as check run output
  yield* report.toCheckRun(checkRunId);

  // Or get raw markdown
  const md = report.toMarkdown();
});
```

## Auto-Merge

Enable auto-merge on pull requests after checks pass.

```typescript
import { Effect } from "effect";
import {
  AutoMerge,
  GitHubGraphQL,
  GitHubGraphQLLive,
} from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  // prNodeId comes from the GraphQL API (not the PR number)
  yield* AutoMerge.enable(prNodeId, "SQUASH");

  // To disable:
  yield* AutoMerge.disable(prNodeId);
});
```

## Semver Resolution

Compare and manipulate semantic versions with Effect error handling.

```typescript
import { Effect } from "effect";
import { SemverResolver } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const cmp = yield* SemverResolver.compare("1.0.0", "2.0.0"); // -1

  const ok = yield* SemverResolver.satisfies("1.5.0", "^1.0.0"); // true

  const best = yield* SemverResolver.latestInRange(
    ["1.0.0", "1.1.0", "2.0.0"],
    "^1.0.0",
  ); // "1.1.0"

  const next = yield* SemverResolver.increment("1.0.0", "minor"); // "1.1.0"

  const parts = yield* SemverResolver.parse("1.2.3-beta.1");
  // { major: 1, minor: 2, patch: 3, prerelease: "beta.1" }
});
```

## Composing Additional Layers

`Action.run` provides core services (ActionInputs, ActionLogger,
ActionOutputs, NodeContext). For additional services, pass a merged layer
as the second argument:

```typescript
import { Layer } from "effect";
import {
  Action,
  ActionStateLive,
  GitHubClientLive,
  GitHubReleaseLive,
  CommandRunnerLive,
  DryRunLive,
} from "@savvy-web/github-action-effects";

const ExtendedLayer = Layer.mergeAll(
  ActionStateLive,
  GitHubClientLive,
  GitHubReleaseLive,
  CommandRunnerLive,
  DryRunLive,
);

Action.run(program, ExtendedLayer);
```

## Error Handling

All errors use `Data.TaggedError` for pattern matching:

```typescript
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const name = yield* inputs.get("name", Schema.String).pipe(
    Effect.catchTag("ActionInputError", (e) => {
      yield* Effect.logError(`Bad input "${e.inputName}": ${e.reason}`);
      return Effect.fail(e);
    }),
  );
}).pipe(
  Effect.catchTag("GitHubClientError", (e) =>
    Effect.logError(`API call "${e.operation}" failed: ${e.reason}`),
  ),
  Effect.catchTag("CommandRunnerError", (e) =>
    Effect.logError(`Command failed: ${e.command}`),
  ),
);
```

`Action.run` catches all uncaught errors and calls `core.setFailed`
automatically, so you only need explicit error handling when you want
custom behavior.

### Action.formatCause

For custom error handlers that need a human-readable message from an Effect
`Cause`, use `Action.formatCause`:

```typescript
import { Effect, Cause } from "effect";
import { Action } from "@savvy-web/github-action-effects";

const program = myEffect.pipe(
  Effect.catchAllCause((cause) => {
    const message = Action.formatCause(cause);
    // message is e.g. "[ActionInputError] Missing required input: token"
    return Effect.logError(message);
  }),
);
```

`formatCause` uses a fallback chain that always produces a non-empty string:

1. **`Cause.squash`** -- extracts the underlying error. If it is a
   `TaggedError`, formats as `[Tag] reason`. If it is a standard `Error`,
   formats as `[Error] message`.
2. **`Cause.pretty`** -- fallback for interrupts and other cause types.
3. **Sentinel** -- `"Unknown error (no diagnostic information available)"`
   as a last resort.

The `[Tag] message` format is designed for consistent parseability by both
humans and AI systems.
