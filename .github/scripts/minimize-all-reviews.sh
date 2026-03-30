#!/usr/bin/env bash
# Wrapper script for minimize_all_bot_reviews function
# This allows Claude to call the function without needing compound bash commands

set -euo pipefail

# Usage: minimize-all-reviews.sh <pr_number> <current_sha> [bot_login] [repo_owner] [repo_name]
PR_NUMBER="${1:?PR number required}"
CURRENT_SHA="${2:?Current SHA required}"
BOT_LOGIN="${3:-savvy-web-bot[bot]}"
REPO_OWNER="${4:-${GITHUB_REPOSITORY_OWNER:-savvy-web}}"
REPO_NAME="${5:-${GITHUB_REPOSITORY##*/}}"
REPO_NAME="${REPO_NAME:-workflow}"

# Source the helper functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./claude-review-helpers.sh disable=SC1091
source "$SCRIPT_DIR/claude-review-helpers.sh"

# Call the function
minimize_all_bot_reviews "$PR_NUMBER" "$CURRENT_SHA" "$BOT_LOGIN" "$REPO_OWNER" "$REPO_NAME"
