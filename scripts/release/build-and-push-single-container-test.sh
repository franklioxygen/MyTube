#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

DOCKER_PATH="${DOCKER_PATH:-docker}"
USERNAME="${USERNAME:-franklioxygen}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/$USERNAME/mytube}"
BUILD_DATE="${BUILD_DATE:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"

# Define platforms to build
PLATFORMS=("linux/amd64" "linux/arm64")

# Tag definitions for TEST
SINGLE_TEST_AMD64="$IMAGE_REPOSITORY:test-amd64"
SINGLE_TEST_ARM64="$IMAGE_REPOSITORY:test-arm64"
SINGLE_TEST="$IMAGE_REPOSITORY:test"

# Docker Buildx adds provenance attestations by default. Some registries can
# fail pushes when these attestation manifests are attached.
ATTESTATION_FLAGS=(--provenance=false --sbom=false)

# Ensure Docker is running
echo "🔍 Checking if Docker is running..."
$DOCKER_PATH ps > /dev/null 2>&1 || {
  echo "❌ Docker is not running. Please start Docker and try again."
  exit 1
}
echo "✅ Docker is running!"

# Ensure buildx builder is available
echo "🔍 Setting up Docker Buildx builder..."
$DOCKER_PATH buildx inspect mytubebuilder > /dev/null 2>&1 || \
  $DOCKER_PATH buildx create --name mytubebuilder --use
$DOCKER_PATH buildx use mytubebuilder
$DOCKER_PATH buildx inspect --bootstrap > /dev/null
echo "✅ Buildx builder ready!"

build_single_platform_image() {
  local platform=$1
  local tag=$2

  echo "🏗️ Building and pushing single-container image for $platform as $tag..."
  $DOCKER_PATH buildx build \
    --platform "$platform" \
    "${ATTESTATION_FLAGS[@]}" \
    --build-arg BUILD_DATE="$BUILD_DATE" \
    -f backend/Dockerfile \
    -t "$tag" \
    --push \
    .
}

echo "🏗️ Building TEST single-container images..."
echo "Platforms: ${PLATFORMS[*]}"
echo "Image repository: $IMAGE_REPOSITORY"
echo ""

for platform in "${PLATFORMS[@]}"; do
  if [ "$platform" = "linux/amd64" ]; then
    build_single_platform_image "$platform" "$SINGLE_TEST_AMD64"
  elif [ "$platform" = "linux/arm64" ]; then
    build_single_platform_image "$platform" "$SINGLE_TEST_ARM64"
  fi
done

echo ""
echo "🏷️  Creating multi-architecture test tag: $SINGLE_TEST"
$DOCKER_PATH buildx imagetools create \
  -t "$SINGLE_TEST" \
  "$SINGLE_TEST_AMD64" \
  "$SINGLE_TEST_ARM64"

echo ""
echo "✅ Successfully built and pushed TEST single-container images!"
echo ""
echo "Main test image (multi-architecture, recommended):"
echo "  - $SINGLE_TEST"
echo ""
echo "Platform-specific images:"
echo "  - $SINGLE_TEST_AMD64"
echo "  - $SINGLE_TEST_ARM64"
echo ""
echo "Single-container compose test:"
echo "  MYTUBE_SINGLE_IMAGE=$SINGLE_TEST docker compose -f docker-compose.single-container.yml up -d"
echo "  MYTUBE_SINGLE_IMAGE=$SINGLE_TEST_AMD64 docker compose -f docker-compose.single-container.yml up -d"
echo "  MYTUBE_SINGLE_IMAGE=$SINGLE_TEST_ARM64 docker compose -f docker-compose.single-container.yml up -d"
echo ""
echo "🕐 Build completed at: $(date '+%Y-%m-%d %H:%M:%S %Z')"
