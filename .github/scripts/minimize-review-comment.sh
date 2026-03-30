#!/usr/bin/env bash
# Wrapper script for minimize_review_comment function
# This allows Claude to call the function without needing compound bash commands

set -euo pipefail

# Usage: minimize-review-comment.sh <comment_id> <commit_sha> [repo_owner] [repo_name]
COMMENT_ID="${1:?Comment ID required}"
COMMIT_SHA="${2:?Commit SHA required}"
REPO_OWNER="${3:-${GITHUB_REPOSITORY_OWNER:-savvy-web}}"
REPO_NAME="${4:-${GITHUB_REPOSITORY##*/}}"
REPO_NAME="${REPO_NAME:-workflow}"

# Source the helper functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./claude-review-helpers.sh disable=SC1091
source "$SCRIPT_DIR/claude-review-helpers.sh"

# Call the function
minimize_review_comment "$COMMENT_ID" "$COMMIT_SHA" "$REPO_OWNER" "$REPO_NAME"
