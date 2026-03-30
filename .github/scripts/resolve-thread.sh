#!/usr/bin/env bash
# Wrapper script for resolve_review_thread function
# This allows Claude to call the function without needing compound bash commands

set -euo pipefail

# Usage: resolve-thread.sh <comment_id> <pr_number> <commit_sha> [repo_owner] [repo_name]
COMMENT_ID="${1:?Comment ID required}"
PR_NUMBER="${2:?PR number required}"
COMMIT_SHA="${3:?Commit SHA required}"
REPO_OWNER="${4:-${GITHUB_REPOSITORY_OWNER:-savvy-web}}"
REPO_NAME="${5:-${GITHUB_REPOSITORY##*/}}"
REPO_NAME="${REPO_NAME:-workflow}"

# Source the helper functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./claude-review-helpers.sh disable=SC1091
source "$SCRIPT_DIR/claude-review-helpers.sh"

# Call the function
resolve_review_thread "$COMMENT_ID" "$PR_NUMBER" "$COMMIT_SHA" "$REPO_OWNER" "$REPO_NAME"
