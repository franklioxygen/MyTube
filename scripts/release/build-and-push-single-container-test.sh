#!/bin/bash
set -euo pipefail

DOCKER_PATH="${DOCKER_PATH:-docker}"
USERNAME="${USERNAME:-franklioxygen}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/$USERNAME/mytube}"

# Define platforms to build
PLATFORMS=("linux/amd64")

# Tag definitions for TEST
SINGLE_TEST_AMD64="$IMAGE_REPOSITORY:test-amd64"
SINGLE_TEST="$IMAGE_REPOSITORY:test"

# Ensure Docker is running
echo "🔍 Checking if Docker is running..."
$DOCKER_PATH ps > /dev/null 2>&1 || {
  echo "❌ Docker is not running. Please start Docker and try again."
  exit 1
}
echo "✅ Docker is running!"

build_single_image() {
  local platform=$1
  local tag=$2
  local additional_tag=$3

  echo "🏗️ Building single-container image for $platform..."
  $DOCKER_PATH build --platform "$platform" -f backend/Dockerfile -t "$tag" .

  if [ -n "$additional_tag" ]; then
    echo "🏷️  Tagging single-container image as: $additional_tag"
    $DOCKER_PATH tag "$tag" "$additional_tag"
  fi

  echo "🚀 Pushing single-container image: $tag"
  $DOCKER_PATH push "$tag"

  if [ -n "$additional_tag" ]; then
    echo "🚀 Pushing single-container additional tag: $additional_tag"
    $DOCKER_PATH push "$additional_tag"
  fi

  echo "🧹 Cleaning up local single-container image: $tag"
  $DOCKER_PATH rmi "$tag" 2>/dev/null || true

  if [ -n "$additional_tag" ]; then
    echo "🧹 Cleaning up local single-container additional tag: $additional_tag"
    $DOCKER_PATH rmi "$additional_tag" 2>/dev/null || true
  fi
}

echo "🏗️ Building TEST single-container images..."
echo "Platforms: ${PLATFORMS[*]}"
echo "Image repository: $IMAGE_REPOSITORY"
echo ""

for platform in "${PLATFORMS[@]}"; do
  if [ "$platform" = "linux/amd64" ]; then
    build_single_image "$platform" "$SINGLE_TEST_AMD64" "$SINGLE_TEST"
  fi
done

echo ""
echo "✅ Successfully built and pushed TEST single-container images!"
echo ""
echo "Main test image (recommended):"
echo "  - $SINGLE_TEST"
echo ""
echo "Platform-specific image:"
echo "  - $SINGLE_TEST_AMD64"
echo ""
echo "Single-container compose test:"
echo "  MYTUBE_SINGLE_IMAGE=$SINGLE_TEST docker compose -f docker-compose.single-container.yml up -d"
echo ""
echo "🕐 Build completed at: $(date '+%Y-%m-%d %H:%M:%S %Z')"
