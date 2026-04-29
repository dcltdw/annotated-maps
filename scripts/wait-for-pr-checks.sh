#!/usr/bin/env zsh
#
# wait-for-pr-checks.sh — wait briefly for the GitHub Actions run on the
# current branch to register, then watch it and play an audio cue when it
# completes (passed / failed).
#
# Usage:
#   scripts/wait-for-pr-checks.sh [branch-name]
#
# Branch defaults to the current git branch. Override the registration
# delay with PR_CHECKS_INITIAL_DELAY=<seconds> (default 10).
#
# Requirements:
#   - `gh` CLI authenticated against this repo
#   - `say` (built-in on macOS; on Linux, swap for paplay/notify-send)

set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
INITIAL_DELAY="${PR_CHECKS_INITIAL_DELAY:-10}"

echo "Waiting ${INITIAL_DELAY}s for the workflow run on '${BRANCH}' to register..."
sleep "${INITIAL_DELAY}"

RUN_ID=$(gh run list \
  --branch "${BRANCH}" \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId' 2>/dev/null || true)

if [[ -z "${RUN_ID}" ]]; then
  echo "No workflow runs found for branch '${BRANCH}'." >&2
  say "No GitHub workflow run found"
  exit 1
fi

echo "Watching run ${RUN_ID} on branch '${BRANCH}'..."

# `gh run watch --exit-status` blocks until the run finishes and
# propagates the run's success/failure as the script's exit code.
if gh run watch "${RUN_ID}" --exit-status; then
  say "PR checks passed"
else
  say "PR checks failed"
  exit 1
fi
