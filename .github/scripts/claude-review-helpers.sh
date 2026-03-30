#!/usr/bin/env bash
# Helper functions for Claude Code review automation
# These functions handle complex GitHub API operations that are difficult
# to express in single-line bash commands due to security restrictions.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Use GITHUB_PAT if available (for operations that need PAT permissions like resolving threads)
# Otherwise fall back to GH_TOKEN
export GH_TOKEN="${GITHUB_PAT:-$GH_TOKEN}"

# Minimize an outdated review comment using GitHub's native minimize feature
# Usage: minimize_review_comment <comment_id> <commit_sha> <repo_owner> <repo_name>
minimize_review_comment() {
    local comment_id=$1
    local commit_sha=$2
    local repo_owner=${3:-savvy-web}
    local repo_name=${4:-workflow}

    if [ -z "$comment_id" ] || [ -z "$commit_sha" ]; then
        echo -e "${RED}Error: comment_id and commit_sha are required${NC}"
        echo "Usage: minimize_review_comment <comment_id> <commit_sha> [repo_owner] [repo_name]"
        return 1
    fi

    echo -e "${YELLOW}Minimizing review comment $comment_id as outdated (commit: $commit_sha)${NC}"

    # Get the comment's node ID (required for GraphQL)
    COMMENT_NODE_ID=$(gh api "repos/$repo_owner/$repo_name/issues/comments/$comment_id" --jq .node_id)

    if [ -z "$COMMENT_NODE_ID" ]; then
        echo -e "${RED}Error: Could not fetch node_id for comment $comment_id${NC}"
        return 1
    fi

    # Minimize the comment using GitHub's GraphQL API
    # shellcheck disable=SC2016  # Single quotes intentional for GraphQL query
    if gh api graphql -f query='
      mutation($subjectId: ID!, $classifier: ReportedContentClassifiers!) {
        minimizeComment(input: {subjectId: $subjectId, classifier: $classifier}) {
          minimizedComment {
            isMinimized
            minimizedReason
          }
        }
      }
    ' -f subjectId="$COMMENT_NODE_ID" -f classifier=OUTDATED; then
        echo -e "${GREEN}✓ Comment $comment_id minimized as outdated${NC}"
    else
        echo -e "${RED}Error: Failed to minimize comment $comment_id${NC}"
        return 1
    fi
}

# Minimize all review comments from a specific user (usually the bot)
# Usage: minimize_all_bot_reviews <pr_number> <current_commit_sha> <bot_login> <repo_owner> <repo_name>
minimize_all_bot_reviews() {
    local pr_number=$1
    local current_sha=$2
    local bot_login=${3:-savvy-web-bot[bot]}
    local repo_owner=${4:-savvy-web}
    local repo_name=${5:-workflow}

    if [ -z "$pr_number" ] || [ -z "$current_sha" ]; then
        echo -e "${RED}Error: pr_number and current_sha are required${NC}"
        echo "Usage: minimize_all_bot_reviews <pr_number> <current_sha> [bot_login] [repo_owner] [repo_name]"
        return 1
    fi

    echo -e "${YELLOW}Finding bot review comments to minimize...${NC}"

    # Get all comments from the bot that look like reviews
    local comment_data
    comment_data=$(gh api "repos/$repo_owner/$repo_name/issues/$pr_number/comments" \
        --jq ".[] | select(.user.login == \"$bot_login\") | select(.body | contains(\"## Code Review\") or contains(\"## Update\")) | {id: .id, created_at: .created_at}")

    if [ -z "$comment_data" ]; then
        echo -e "${GREEN}No bot review comments found to minimize${NC}"
        return 0
    fi

    # Process each comment
    echo "$comment_data" | while read -r line; do
        if [ -n "$line" ]; then
            comment_id=$(echo "$line" | jq -r .id)
            minimize_review_comment "$comment_id" "$current_sha" "$repo_owner" "$repo_name"
        fi
    done

    echo -e "${GREEN}✓ All bot reviews minimized${NC}"
}

# Resolve a review comment thread when an issue is fixed
# Usage: resolve_review_thread <comment_id> <pr_number> <commit_sha> <repo_owner> <repo_name>
resolve_review_thread() {
    local comment_id=$1
    local pr_number=$2
    local commit_sha=$3
    local repo_owner=${4:-savvy-web}
    local repo_name=${5:-workflow}

    if [ -z "$comment_id" ] || [ -z "$pr_number" ] || [ -z "$commit_sha" ]; then
        echo -e "${RED}Error: comment_id, pr_number, and commit_sha are required${NC}"
        echo "Usage: resolve_review_thread <comment_id> <pr_number> <commit_sha> [repo_owner] [repo_name]"
        return 1
    fi

    echo -e "${YELLOW}Resolving review thread $comment_id${NC}"

    # First, reply to the thread
    gh api "repos/$repo_owner/$repo_name/pulls/$pr_number/comments/$comment_id/replies" \
        -f body="✅ Fixed in \`$commit_sha\`. Thanks!"

    # Then resolve the thread
    local current_body
    current_body=$(gh api "repos/$repo_owner/$repo_name/pulls/comments/$comment_id" --jq .body)

    echo "$current_body" | gh api --method PATCH \
        "repos/$repo_owner/$repo_name/pulls/comments/$comment_id" \
        -f body=@- \
        -F resolved=true

    echo -e "${GREEN}✓ Thread $comment_id resolved${NC}"
}

# Export functions so they can be called from Claude's bash commands
export -f minimize_review_comment
export -f minimize_all_bot_reviews
export -f resolve_review_thread

# If script is run directly, provide usage information
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    echo "Claude Code Review Helper Functions"
    echo "===================================="
    echo ""
    echo "Available functions:"
    echo "  minimize_review_comment <comment_id> <commit_sha> [repo_owner] [repo_name]"
    echo "    Minimizes a review comment as outdated using GitHub's native minimize feature"
    echo ""
    echo "  minimize_all_bot_reviews <pr_number> <current_sha> [bot_login] [repo_owner] [repo_name]"
    echo "    Minimizes all bot review comments as outdated"
    echo ""
    echo "  resolve_review_thread <comment_id> <pr_number> <commit_sha> [repo_owner] [repo_name]"
    echo "    Replies to a review thread to confirm a fix and marks the thread as resolved"
    echo ""
    echo "Usage: source this script to make functions available in your shell"
    echo "  source .github/scripts/claude-review-helpers.sh"
    echo "  minimize_review_comment 123456 abc123"
fi
