#!/usr/bin/env bash
# Merges OpenWhispr's main into a new sync/upstream-<date> branch cut from main.
# See .github/CONTRIBUTING.md, "Keeping up with upstream".
set -euo pipefail

UPSTREAM_URL="https://github.com/OpenWhispr/openwhispr.git"
BASE="${1:-main}"

cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit or stash your changes first." >&2
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream "$UPSTREAM_URL"
fi
# The fork's release tags reuse upstream's version numbers for different
# commits, so fetching upstream tags would clash with ours.
git config remote.upstream.tagOpt --no-tags
git fetch --no-tags upstream main
git fetch origin "$BASE"

behind=$(git rev-list --count "origin/$BASE..upstream/main")
if [ "$behind" -eq 0 ]; then
  echo "origin/$BASE already contains upstream/main."
  exit 0
fi
echo "upstream/main has $behind commits that origin/$BASE doesn't."

branch="sync/upstream-$(date +%Y-%m-%d)"
git switch -c "$branch" "origin/$BASE"

if git merge --no-ff --no-edit -m "Merge upstream OpenWhispr main into MoreOpenWhisperer" upstream/main; then
  echo
  echo "Merged cleanly on $branch. Next: npm ci, npm run quality-check, npm test,"
  echo "then push and open a PR against $BASE. Merge it with a merge commit, not a squash."
else
  echo
  echo "Conflicts on $branch:"
  git diff --name-only --diff-filter=U | sed 's/^/  /'
  echo
  echo "Resolve them, git add the files, git commit, run the checks, then open a PR"
  echo "against $BASE. Merge it with a merge commit, not a squash."
  exit 1
fi
