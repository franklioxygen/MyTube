#!/bin/bash
set -e

DOCKER_PATH="/Applications/Docker.app/Contents/Resources/bin/docker"
USERNAME="franklioxygen"

# Default build arguments (can be overridden by environment variables)
VITE_API_URL=${VITE_API_URL:-"http://localhost:5551/api"}
VITE_BACKEND_URL=${VITE_BACKEND_URL:-"http://localhost:5551"}

# Define platforms to build
# Commented out arm64 as requested
PLATFORMS=("linux/amd64") # "linux/arm64")

# Tag definitions for TEST
BACKEND_TEST_AMD64="$USERNAME/mytube:backend-test-amd64"
# BACKEND_TEST_ARM64="$USERNAME/mytube:backend-test-arm64"
FRONTEND_TEST_AMD64="$USERNAME/mytube:frontend-test-amd64"
# FRONTEND_TEST_ARM64="$USERNAME/mytube:frontend-test-arm64"

# Ensure Docker is running
echo "🔍 Checking if Docker is running..."
$DOCKER_PATH ps > /dev/null 2>&1 || { echo "❌ Docker is not running. Please start Docker and try again."; exit 1; }
echo "✅ Docker is running!"

# Prune builder cache to free up space
echo "🧹 Pruning Docker builder cache..."
$DOCKER_PATH builder prune --all --force

# Function to build backend for a specific platform
build_backend() {
  local platform=$1
  local tag=$2
  
  echo "🏗️ Building backend for $platform..."
  # Run build from root context to allow copying frontend files
  # Use -f backend/Dockerfile to specify the Dockerfile path
  $DOCKER_PATH build --no-cache --platform $platform -f backend/Dockerfile -t $tag .
  
  echo "🚀 Pushing backend image: $tag"
  $DOCKER_PATH push $tag
  
  echo "🧹 Cleaning up local backend image: $tag"
  $DOCKER_PATH rmi $tag
}

# Function to build frontend for a specific platform
build_frontend() {
  local platform=$1
  local tag=$2
  
  echo "🏗️ Building frontend for $platform..."
  cd frontend
  $DOCKER_PATH build --no-cache --platform $platform \
    --build-arg VITE_API_URL="$VITE_API_URL" \
    --build-arg VITE_BACKEND_URL="$VITE_BACKEND_URL" \
    -t $tag .
  
  echo "🚀 Pushing frontend image: $tag"
  $DOCKER_PATH push $tag
  
  echo "🧹 Cleaning up local frontend image: $tag"
  $DOCKER_PATH rmi $tag
  
  cd ..
}

# Function to create and push manifest list
# create_and_push_manifest() {
#   local manifest_tag=$1
#   local image_amd64=$2
#   local image_arm64=$3
#
#   echo "📜 Creating manifest list: $manifest_tag"
#   # Try to remove existing manifest first to avoid errors
#   $DOCKER_PATH manifest rm $manifest_tag 2>/dev/null || true
#   
#   if ! $DOCKER_PATH manifest create $manifest_tag \
#     --amend $image_amd64 \
#     --amend $image_arm64 2>/dev/null; then
#     echo "⚠️  Failed to create manifest list: $manifest_tag"
#     echo "   This might happen if the images are not yet available in the registry."
#     echo "   The platform-specific images are still available individually."
#     return 1
#   fi
#
#   echo "🚀 Pushing manifest list: $manifest_tag"
#   if ! $DOCKER_PATH manifest push $manifest_tag; then
#     echo "⚠️  Failed to push manifest list: $manifest_tag"
#     $DOCKER_PATH manifest rm $manifest_tag 2>/dev/null || true
#     return 1
#   fi
#   
#   echo "🧹 Cleaning up local manifest: $manifest_tag"
#   $DOCKER_PATH manifest rm $manifest_tag 2>/dev/null || true
#   return 0
# }

# Build for each platform
echo "🏗️ Building TEST images for multiple platforms with separate tags..."
echo "Platforms: ${PLATFORMS[*]}"
echo ""

# Build backend for all platforms
for platform in "${PLATFORMS[@]}"; do
  if [ "$platform" = "linux/amd64" ]; then
    build_backend "$platform" "$BACKEND_TEST_AMD64"
  elif [ "$platform" = "linux/arm64" ]; then
    # build_backend "$platform" "$BACKEND_TEST_ARM64"
    echo "Skipping arm64"
  fi
done

echo ""

# Build frontend for all platforms
for platform in "${PLATFORMS[@]}"; do
  if [ "$platform" = "linux/amd64" ]; then
    build_frontend "$platform" "$FRONTEND_TEST_AMD64"
  elif [ "$platform" = "linux/arm64" ]; then
    # build_frontend "$platform" "$FRONTEND_TEST_ARM64"
    echo "Skipping arm64"
  fi
done

echo ""

# Create and push manifests
echo "📦 Tagging and pushing main test tags (amd64)..."

# MANIFEST_ERRORS=0

# Backend
# if ! create_and_push_manifest "$USERNAME/mytube:backend-test" "$BACKEND_TEST_AMD64" "$BACKEND_TEST_ARM64"; then
#   MANIFEST_ERRORS=$((MANIFEST_ERRORS + 1))
# fi
echo "🚀 Tagging and pushing backend test tag..."
$DOCKER_PATH pull "$BACKEND_TEST_AMD64" # Ensure we have it locally if it was cleaned up (though build cleaned it up, so we need to re-tag BEFORE cleanup or pull it again. Wait, build func cleans up.
# Ah, the build function cleans up: `$DOCKER_PATH rmi $tag`
# So $BACKEND_TEST_AMD64 is GONE locally.
# We need to re-pull it or NOT clean it up in the build function if we want to re-tag it.
# OR, we just tag it remotely? No, docker tag is local.
# We must pull it again or change the build function.
# Changing the build function is cleaner but risky if I don't want to change the structure too much.
# But calling pull is safe.
$DOCKER_PATH pull "$BACKEND_TEST_AMD64"
$DOCKER_PATH tag "$BACKEND_TEST_AMD64" "$USERNAME/mytube:backend-test"
$DOCKER_PATH push "$USERNAME/mytube:backend-test"
$DOCKER_PATH rmi "$USERNAME/mytube:backend-test"

# Frontend
# if ! create_and_push_manifest "$USERNAME/mytube:frontend-test" "$FRONTEND_TEST_AMD64" "$FRONTEND_TEST_ARM64"; then
#   MANIFEST_ERRORS=$((MANIFEST_ERRORS + 1))
# fi
echo "🚀 Tagging and pushing frontend test tag..."
$DOCKER_PATH pull "$FRONTEND_TEST_AMD64"
$DOCKER_PATH tag "$FRONTEND_TEST_AMD64" "$USERNAME/mytube:frontend-test"
$DOCKER_PATH push "$USERNAME/mytube:frontend-test"
$DOCKER_PATH rmi "$USERNAME/mytube:frontend-test"

# if [ $MANIFEST_ERRORS -gt 0 ]; then
#   echo ""
#   echo "⚠️  Some manifest lists failed to create/push ($MANIFEST_ERRORS error(s))"
#   echo "   Platform-specific images are still available and can be used directly."
# fi

echo ""
echo "✅ Successfully built and pushed TEST images (amd64 only) to Docker Hub!"
echo ""
echo "Images:"
echo "  - $USERNAME/mytube:backend-test (amd64)"
echo "  - $USERNAME/mytube:frontend-test (amd64)"
echo ""
echo "Platform-specific images:"
echo "  Backend:"
echo "    - $BACKEND_TEST_AMD64"
# echo "    - $BACKEND_TEST_ARM64"
echo "  Frontend:"
echo "    - $FRONTEND_TEST_AMD64"
# echo "    - $FRONTEND_TEST_ARM64"
