#!/bin/bash
set -e

DOCKER_PATH="/Applications/Docker.app/Contents/Resources/bin/docker"
USERNAME="franklioxygen"

# Default build arguments (can be overridden by environment variables)
VITE_API_URL=${VITE_API_URL:-"http://localhost:5551/api"}
VITE_BACKEND_URL=${VITE_BACKEND_URL:-"http://localhost:5551"}

# Define platforms to build
PLATFORMS=("linux/amd64") 

# Tag definitions for TEST
BACKEND_TEST_AMD64="$USERNAME/mytube:backend-test-amd64"
FRONTEND_TEST_AMD64="$USERNAME/mytube:frontend-test-amd64"

# Ensure Docker is running
echo "🔍 Checking if Docker is running..."
$DOCKER_PATH ps > /dev/null 2>&1 || { echo "❌ Docker is not running. Please start Docker and try again."; exit 1; }
echo "✅ Docker is running!"



# Function to build backend for a specific platform
build_backend() {
  local platform=$1
  local tag=$2
  local additional_tag=$3  # Optional additional tag to create before cleanup
  
  echo "🏗️ Building backend for $platform..."
  # Run build from root context to allow copying frontend files
  # Use -f backend/Dockerfile to specify the Dockerfile path
  $DOCKER_PATH build --platform $platform -f backend/Dockerfile -t $tag .
  
  # Create additional tag if provided (before pushing, so we can push both)
  if [ -n "$additional_tag" ]; then
    echo "🏷️  Tagging backend image as: $additional_tag"
    $DOCKER_PATH tag $tag $additional_tag
  fi
  
  echo "🚀 Pushing backend image: $tag"
  $DOCKER_PATH push $tag
  
  # Push additional tag if provided
  if [ -n "$additional_tag" ]; then
    echo "🚀 Pushing backend additional tag: $additional_tag"
    $DOCKER_PATH push $additional_tag
  fi
  
  echo "🧹 Cleaning up local backend image: $tag"
  $DOCKER_PATH rmi $tag 2>/dev/null || true
  if [ -n "$additional_tag" ]; then
    echo "🧹 Cleaning up local backend additional tag: $additional_tag"
    $DOCKER_PATH rmi $additional_tag 2>/dev/null || true
  fi
}

# Function to build frontend for a specific platform
build_frontend() {
  local platform=$1
  local tag=$2
  local additional_tag=$3  # Optional additional tag to create before cleanup
  
  echo "🏗️ Building frontend for $platform..."
  cd frontend
  $DOCKER_PATH build --platform $platform \
    --build-arg VITE_API_URL="$VITE_API_URL" \
    --build-arg VITE_BACKEND_URL="$VITE_BACKEND_URL" \
    -t $tag .
  
  # Create additional tag if provided (before pushing, so we can push both)
  if [ -n "$additional_tag" ]; then
    echo "🏷️  Tagging frontend image as: $additional_tag"
    $DOCKER_PATH tag $tag $additional_tag
  fi
  
  echo "🚀 Pushing frontend image: $tag"
  $DOCKER_PATH push $tag
  
  # Push additional tag if provided
  if [ -n "$additional_tag" ]; then
    echo "🚀 Pushing frontend additional tag: $additional_tag"
    $DOCKER_PATH push $additional_tag
  fi
  
  echo "🧹 Cleaning up local frontend image: $tag"
  $DOCKER_PATH rmi $tag 2>/dev/null || true
  if [ -n "$additional_tag" ]; then
    echo "🧹 Cleaning up local frontend additional tag: $additional_tag"
    $DOCKER_PATH rmi $additional_tag 2>/dev/null || true
  fi
  
  cd ..
}


# Build for each platform
echo "🏗️ Building TEST images for multiple platforms with separate tags..."
echo "Platforms: ${PLATFORMS[*]}"
echo ""

# Tag definitions for main test tags (without platform suffix)
BACKEND_TEST="$USERNAME/mytube:backend-test"
FRONTEND_TEST="$USERNAME/mytube:frontend-test"

# Build backend for all platforms
for platform in "${PLATFORMS[@]}"; do
  if [ "$platform" = "linux/amd64" ]; then
    build_backend "$platform" "$BACKEND_TEST_AMD64" "$BACKEND_TEST"
  fi
done

echo ""

# Build frontend for all platforms
for platform in "${PLATFORMS[@]}"; do
  if [ "$platform" = "linux/amd64" ]; then
    build_frontend "$platform" "$FRONTEND_TEST_AMD64" "$FRONTEND_TEST"
  fi
done

echo ""
echo "✅ Successfully built and pushed TEST images (amd64 only) to Docker Hub!"
echo ""
echo "Main test images (recommended):"
echo "  - $BACKEND_TEST"
echo "  - $FRONTEND_TEST"
echo ""
echo "Platform-specific images:"
echo "  Backend:"
echo "    - $BACKEND_TEST_AMD64"
echo "  Frontend:"
echo "    - $FRONTEND_TEST_AMD64"
echo ""
echo "🕐 Build completed at: $(date '+%Y-%m-%d %H:%M:%S %Z')"