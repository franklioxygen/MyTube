#!/bin/bash
set -e

# Function to display usage
usage() {
  echo "Usage: $0 <version|major|minor|patch>"
  echo "Examples:"
  echo "  $0 1.2.0"
  echo "  $0 patch"
  exit 1
}

# Check if argument is provided
if [ -z "$1" ]; then
  usage
fi

INPUT_VERSION=$1

# Ensure git workspace is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Git workspace is not clean. Please commit or stash changes first."
  exit 1
fi

# Ensure we are on master branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "master" ]; then
  echo "⚠️  You are not on the master branch (current: $CURRENT_BRANCH)."
  read -p "Do you want to continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Update version in package.json files
echo "🔄 Updating version numbers..."
npm version $INPUT_VERSION --no-git-tag-version --allow-same-version

# Get the new version number
NEW_VERSION=$(node -p "require('./package.json').version")
echo "✅ New version: $NEW_VERSION"

# Update sub-packages
cd frontend && npm version $NEW_VERSION --no-git-tag-version --allow-same-version && cd ..
cd backend && npm version $NEW_VERSION --no-git-tag-version --allow-same-version && cd ..

# Commit and Tag
echo "📦 Committing and tagging..."
git add package.json frontend/package.json backend/package.json package-lock.json frontend/package-lock.json backend/package-lock.json
git commit -m "chore(release): v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push origin master

echo "✅ Version bumped and tagged: v$NEW_VERSION"

# Build and Push
echo "🚀 Starting build and push process..."
./build-and-push.sh $NEW_VERSION

echo "🎉 Release v$NEW_VERSION completed successfully!"
