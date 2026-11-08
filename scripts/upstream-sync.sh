#!/usr/bin/env bash
# Daily upstream sync for the Voice fork (fork-only; run by .github/workflows/upstream-sync.yml).
#
# Merges upstream's main into the fork's main with a merge commit (never a rebase or squash, so every
# upstream commit keeps its hash and the next sync starts from there), and pushes only to `origin`,
# the fork: the `upstream` remote's push URL is set to DISABLED before anything else. When the merge
# would conflict, nothing lands on main: upstream's main goes to a `sync/upstream-<sha>` branch on the
# fork and a pull request there asks for the conflicts to be resolved by hand.
#
# DRY_RUN=1 prints what it would change (checkout, merge, push, pull request) instead of doing it;
# everything it only reads (fetch, merge-tree) still runs.
set -euo pipefail

UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/PortSwigger/agent-wrangler.git}
BASE=${BASE:-main}
REPO=${REPO:-${GITHUB_REPOSITORY:-}}
DRY_RUN=${DRY_RUN:-}

run() { if [ -n "$DRY_RUN" ]; then echo "+ $*"; else "$@"; fi; }

if ! git remote get-url upstream >/dev/null 2>&1; then git remote add upstream "$UPSTREAM_URL"; fi
git remote set-url --push upstream DISABLED
git fetch --quiet --no-tags origin "$BASE"
git fetch --quiet --no-tags upstream main

ours=$(git rev-parse "origin/$BASE")
theirs=$(git rev-parse upstream/main)
short=$(git rev-parse --short upstream/main)
echo "origin/$BASE at $(git rev-parse --short "$ours"), upstream/main at $short (upstream push URL: $(git remote get-url --push upstream))"

if git merge-base --is-ancestor "$theirs" "$ours"; then
  echo "Already up to date: upstream/main is in origin/$BASE"
  exit 0
fi
echo "upstream/main is $(git rev-list --count "$ours..$theirs") commit(s) ahead of origin/$BASE"

# merge-tree only reads: exit 0 is a clean merge, 1 a conflict.
if git merge-tree --write-tree "$ours" "$theirs" >/dev/null; then
  echo "Clean merge: merging upstream/main into $BASE with a merge commit"
  run git checkout --quiet -B "$BASE" "$ours"
  run git merge --no-ff --no-edit -m "Merge upstream/main ($short) into $BASE" "$theirs"
  run git push origin "HEAD:refs/heads/$BASE"
  exit 0
fi

branch="sync/upstream-$short"
echo "Conflicts: nothing lands on $BASE; opening a pull request from $branch instead"
git merge-tree --write-tree --name-only "$ours" "$theirs" | sed -n '2,$p' | sed 's/^/  conflict: /' || true
run git push origin "$theirs:refs/heads/$branch"
if [ -z "$DRY_RUN" ] && [ -n "$(gh pr list --repo "$REPO" --head "$branch" --state open --json number --jq '.[].number')" ]; then
  echo "A pull request for $branch is already open"
  exit 0
fi
run gh pr create --repo "$REPO" --base "$BASE" --head "$branch" \
  --title "Sync upstream main ($short): resolve conflicts" \
  --body "Upstream's main ($short) does not merge cleanly into $BASE. Resolve the conflicts on this branch with a merge commit, keeping Voice's hook points in upstream files small, and merge it with a merge commit, not a squash."
