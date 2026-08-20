#!/usr/bin/env bash
#
# Sync nedu10/health-app-backend (private, "nedu") -> OFUZORCHUKWUEMEKE/health-app (public, "origin").
#
# The two repos have unrelated histories, so a normal merge/pull is not usable.
# Instead this replays the *content* of nedu/main onto origin/main as a snapshot
# commit, with .env and friends stripped out so secrets never reach the public repo.
#
# Usage:
#   scripts/sync-main-to-public.sh            # stage the sync locally, show the diff, stop
#   scripts/sync-main-to-public.sh --push     # ...and push to origin/main
#
set -euo pipefail

UPSTREAM_REMOTE=nedu
UPSTREAM_BRANCH=main
PUBLIC_REMOTE=origin
PUBLIC_BRANCH=main

# Paths that must never exist in the public repo, whatever upstream does.
EXCLUDE=(.env .env.local .env.production .env.development)

PUSH=0
[[ "${1:-}" == "--push" ]] && PUSH=1

cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree has uncommitted changes; commit or stash them first." >&2
  exit 1
fi

ORIGINAL_REF=$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)
restore() { git checkout --quiet "$ORIGINAL_REF"; }
trap restore EXIT

echo "==> fetching"
git fetch --quiet "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"
git fetch --quiet "$PUBLIC_REMOTE" "$PUBLIC_BRANCH"

UPSTREAM_SHA=$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")

# Build the target tree in a scratch index: upstream's content, minus the excluded paths.
SCRATCH_INDEX=$(mktemp -t sync-index.XXXXXX)
rm -f "$SCRATCH_INDEX"
cleanup_index() { rm -f "$SCRATCH_INDEX"; }
trap 'cleanup_index; restore' EXIT

GIT_INDEX_FILE="$SCRATCH_INDEX" git read-tree "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
for path in "${EXCLUDE[@]}"; do
  GIT_INDEX_FILE="$SCRATCH_INDEX" git rm --cached --quiet --ignore-unmatch -- "$path"
done
TARGET_TREE=$(GIT_INDEX_FILE="$SCRATCH_INDEX" git write-tree)

echo "==> checking out $PUBLIC_BRANCH"
git checkout --quiet "$PUBLIC_BRANCH"
git merge --quiet --ff-only "$PUBLIC_REMOTE/$PUBLIC_BRANCH"

# Apply the filtered upstream tree. Untracked local files (your real .env) are left alone.
git read-tree -u --reset "$TARGET_TREE"

if git diff --cached --quiet HEAD; then
  echo "==> already in sync with $UPSTREAM_REMOTE/$UPSTREAM_BRANCH ($(git rev-parse --short "$UPSTREAM_SHA")); nothing to do."
  exit 0
fi

echo
echo "==> changes to publish:"
git diff --cached --stat HEAD
echo

git commit --quiet -m "Sync with ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} @ $(git rev-parse --short "$UPSTREAM_SHA")"

# Hard stop: refuse to leave an excluded path in the public branch's tree.
for path in "${EXCLUDE[@]}"; do
  if git ls-tree -r --name-only HEAD | grep -qxF "$path"; then
    echo "error: '$path' ended up in the sync commit; refusing to continue." >&2
    git reset --hard --quiet "$PUBLIC_REMOTE/$PUBLIC_BRANCH"
    exit 1
  fi
done

echo "==> committed $(git rev-parse --short HEAD) on $PUBLIC_BRANCH"

if [[ $PUSH -eq 1 ]]; then
  echo "==> pushing to $PUBLIC_REMOTE/$PUBLIC_BRANCH"
  git push "$PUBLIC_REMOTE" "$PUBLIC_BRANCH"
else
  echo
  echo "Not pushed. Review, then run:"
  echo "    git push $PUBLIC_REMOTE $PUBLIC_BRANCH"
fi
