#!/usr/bin/env bash

set -u

BRANCH="agent/railway-sync"

echo
echo "========================================"
echo " ATLAS LOCAL / GIT SYNC CHECK"
echo "========================================"
echo

echo "Current directory:"
pwd

echo
echo "Current branch:"
git branch --show-current

echo
echo "Local HEAD:"
git rev-parse HEAD

echo
echo "Local short HEAD:"
git rev-parse --short HEAD

echo
echo "Fetching origin..."
git fetch origin --prune

echo
echo "Remote branch HEAD:"
git rev-parse "origin/${BRANCH}"

echo
echo "Remote branch short HEAD:"
git rev-parse --short "origin/${BRANCH}"

echo
echo "Working tree:"
git status -sb

echo
echo "Commits only in Local:"
LOCAL_ONLY="$(
  git log \
    --oneline \
    "origin/${BRANCH}..HEAD"
)"

if [ -n "$LOCAL_ONLY" ]; then
  echo "$LOCAL_ONLY"
else
  echo "None"
fi

echo
echo "Commits only in Remote:"
REMOTE_ONLY="$(
  git log \
    --oneline \
    "HEAD..origin/${BRANCH}"
)"

if [ -n "$REMOTE_ONLY" ]; then
  echo "$REMOTE_ONLY"
else
  echo "None"
fi

echo
echo "Changed files not committed:"
CHANGED="$(
  git status \
    --porcelain
)"

if [ -n "$CHANGED" ]; then
  echo "$CHANGED"
else
  echo "None"
fi

echo
echo "Recent commits:"
git log \
  --oneline \
  --decorate \
  -10

echo
echo "========================================"

LOCAL_HEAD="$(
  git rev-parse HEAD
)"

REMOTE_HEAD="$(
  git rev-parse "origin/${BRANCH}"
)"

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  echo "Git synchronization: OK"
else
  echo "Git synchronization: OUT OF SYNC"
fi

if [ -n "$CHANGED" ]; then
  echo "Working tree: HAS UNCOMMITTED CHANGES"
else
  echo "Working tree: CLEAN"
fi

echo "========================================"
