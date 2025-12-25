#!/bin/bash
set -e

DOCKER_PATH="/Applications/Docker.app/Contents/Resources/bin/docker"
USERNAME="franklioxygen"
VERSION=$1

# Default build arguments (can be overridden by environment variables)
VITE_API_URL=${VITE_API_URL:-"http://localhost:5551/api"}
VITE_BACKEND_URL=${VITE_BACKEND_URL:-"http://localhost:5551"}

# Define platforms to build
PLATFORMS=("linux/amd64" "linux/arm64")

# Tag definitions
BACKEND_LATEST_AMD64="$USERNAME/mytube:backend-latest-amd64"
BACKEND_LATEST_ARM64="$USERNAME/mytube:backend-latest-arm64"
FRONTEND_LATEST_AMD64="$USERNAME/mytube:frontend-latest-amd64"
FRONTEND_LATEST_ARM64="$USERNAME/mytube:frontend-latest-arm64"

if [ -n "$VERSION" ]; then
  echo "🔖 Version specified: $VERSION"
  BACKEND_VERSION_AMD64="$USERNAME/mytube:backend-$VERSION-amd64"
  BACKEND_VERSION_ARM64="$USERNAME/mytube:backend-$VERSION-arm64"
  FRONTEND_VERSION_AMD64="$USERNAME/mytube:frontend-$VERSION-amd64"
  FRONTEND_VERSION_ARM64="$USERNAME/mytube:frontend-$VERSION-arm64"
fi

# Ensure Docker is running
echo "🔍 Checking if Docker is running..."
$DOCKER_PATH ps > /dev/null 2>&1 || { echo "❌ Docker is not running. Please start Docker and try again."; exit 1; }
echo "✅ Docker is running!"

# Function to build backend for a specific platform
build_backend() {
  local platform=$1
  local tag=$2
  local version_tag=$3
  
  echo "🏗️ Building backend for $platform..."
  cd backend
  $DOCKER_PATH build --no-cache --platform $platform -t $tag .
  
  if [ -n "$VERSION" ] && [ -n "$version_tag" ]; then
    $DOCKER_PATH tag $tag $version_tag
  fi
  
  echo "🚀 Pushing backend image: $tag"
  $DOCKER_PATH push $tag
  
  if [ -n "$VERSION" ] && [ -n "$version_tag" ]; then
    echo "🚀 Pushing backend version image: $version_tag"
    $DOCKER_PATH push $version_tag
  fi
  
  echo "🧹 Cleaning up local backend image: $tag"
  $DOCKER_PATH rmi $tag
  if [ -n "$VERSION" ] && [ -n "$version_tag" ]; then
    $DOCKER_PATH rmi $version_tag
  fi
  
  cd ..
}

# Function to build frontend for a specific platform
build_frontend() {
  local platform=$1
  local tag=$2
  local version_tag=$3
  
  echo "🏗️ Building frontend for $platform..."
  cd frontend
  $DOCKER_PATH build --no-cache --platform $platform \
    --build-arg VITE_API_URL="$VITE_API_URL" \
    --build-arg VITE_BACKEND_URL="$VITE_BACKEND_URL" \
    -t $tag .
  
  if [ -n "$VERSION" ] && [ -n "$version_tag" ]; then
    $DOCKER_PATH tag $tag $version_tag
  fi
  
  echo "🚀 Pushing frontend image: $tag"
  $DOCKER_PATH push $tag
  
  if [ -n "$VERSION" ] && [ -n "$version_tag" ]; then
    echo "🚀 Pushing frontend version image: $version_tag"
    $DOCKER_PATH push $version_tag
  fi
  
  echo "🧹 Cleaning up local frontend image: $tag"
  $DOCKER_PATH rmi $tag
  if [ -n "$VERSION" ] && [ -n "$version_tag" ]; then
    $DOCKER_PATH rmi $version_tag
  fi
  
  cd ..
}

# Function to create and push manifest list
create_and_push_manifest() {
  local manifest_tag=$1
  local image_amd64=$2
  local image_arm64=$3

  echo "📜 Creating manifest list: $manifest_tag"
  # Try to remove existing manifest first to avoid errors
  $DOCKER_PATH manifest rm $manifest_tag 2>/dev/null || true
  
  if ! $DOCKER_PATH manifest create $manifest_tag \
    --amend $image_amd64 \
    --amend $image_arm64 2>/dev/null; then
    echo "⚠️  Failed to create manifest list: $manifest_tag"
    echo "   This might happen if the images are not yet available in the registry."
    echo "   The platform-specific images are still available individually."
    return 1
  fi

  echo "🚀 Pushing manifest list: $manifest_tag"
  if ! $DOCKER_PATH manifest push $manifest_tag; then
    echo "⚠️  Failed to push manifest list: $manifest_tag"
    $DOCKER_PATH manifest rm $manifest_tag 2>/dev/null || true
    return 1
  fi
  
  echo "🧹 Cleaning up local manifest: $manifest_tag"
  $DOCKER_PATH manifest rm $manifest_tag 2>/dev/null || true
  return 0
}

# Build for each platform
echo "🏗️ Building images for multiple platforms with separate tags..."
echo "Platforms: ${PLATFORMS[*]}"
echo ""

# Build backend for all platforms
for platform in "${PLATFORMS[@]}"; do
  if [ "$platform" = "linux/amd64" ]; then
    build_backend "$platform" "$BACKEND_LATEST_AMD64" "${BACKEND_VERSION_AMD64:-}"
  elif [ "$platform" = "linux/arm64" ]; then
    build_backend "$platform" "$BACKEND_LATEST_ARM64" "${BACKEND_VERSION_ARM64:-}"
  fi
done

echo ""

# Build frontend for all platforms
for platform in "${PLATFORMS[@]}"; do
  if [ "$platform" = "linux/amd64" ]; then
    build_frontend "$platform" "$FRONTEND_LATEST_AMD64" "${FRONTEND_VERSION_AMD64:-}"
  elif [ "$platform" = "linux/arm64" ]; then
    build_frontend "$platform" "$FRONTEND_LATEST_ARM64" "${FRONTEND_VERSION_ARM64:-}"
  fi
done

echo ""

# Create and push manifests
echo "📦 Creating and pushing manifests..."

MANIFEST_ERRORS=0

# Backend Manifests
if ! create_and_push_manifest "$USERNAME/mytube:backend-latest" "$BACKEND_LATEST_AMD64" "$BACKEND_LATEST_ARM64"; then
  MANIFEST_ERRORS=$((MANIFEST_ERRORS + 1))
fi

if [ -n "$VERSION" ]; then
  if ! create_and_push_manifest "$USERNAME/mytube:backend-$VERSION" "$BACKEND_VERSION_AMD64" "$BACKEND_VERSION_ARM64"; then
    MANIFEST_ERRORS=$((MANIFEST_ERRORS + 1))
  fi
fi

# Frontend Manifests
if ! create_and_push_manifest "$USERNAME/mytube:frontend-latest" "$FRONTEND_LATEST_AMD64" "$FRONTEND_LATEST_ARM64"; then
  MANIFEST_ERRORS=$((MANIFEST_ERRORS + 1))
fi

if [ -n "$VERSION" ]; then
  if ! create_and_push_manifest "$USERNAME/mytube:frontend-$VERSION" "$FRONTEND_VERSION_AMD64" "$FRONTEND_VERSION_ARM64"; then
    MANIFEST_ERRORS=$((MANIFEST_ERRORS + 1))
  fi
fi

if [ $MANIFEST_ERRORS -gt 0 ]; then
  echo ""
  echo "⚠️  Some manifest lists failed to create/push ($MANIFEST_ERRORS error(s))"
  echo "   Platform-specific images are still available and can be used directly."
fi

echo ""
echo "✅ Successfully built and pushed images to Docker Hub!"
echo ""
echo "Multi-architecture images (auto-selects platform):"
echo "  - $USERNAME/mytube:backend-latest"
echo "  - $USERNAME/mytube:frontend-latest"
if [ -n "$VERSION" ]; then
  echo "  - $USERNAME/mytube:backend-$VERSION"
  echo "  - $USERNAME/mytube:frontend-$VERSION"
fi
echo ""
echo "Platform-specific images (explicit architecture):"
echo "  Backend:"
echo "    - $BACKEND_LATEST_AMD64"
echo "    - $BACKEND_LATEST_ARM64"
echo "  Frontend:"
echo "    - $FRONTEND_LATEST_AMD64"
echo "    - $FRONTEND_LATEST_ARM64"

if [ -n "$VERSION" ]; then
  echo ""
  echo "Versioned platform-specific images:"
  echo "  Backend:"
  echo "    - $BACKEND_VERSION_AMD64"
  echo "    - $BACKEND_VERSION_ARM64"
  echo "  Frontend:"
  echo "    - $FRONTEND_VERSION_AMD64"
  echo "    - $FRONTEND_VERSION_ARM64"
fi

echo ""
echo "To deploy to your server or QNAP Container Station:"
echo "1. Use the multi-arch tags in docker-compose.yml (recommended):"
echo "   - Docker will automatically select the correct architecture"
echo "   - Example: franklioxygen/mytube:backend-latest"
echo ""
echo "2. Or use platform-specific tags for explicit control:"
echo "   - For amd64: use tags ending with '-amd64'"
echo "   - For arm64: use tags ending with '-arm64'"
echo ""
echo "3. Set environment variables in your docker-compose.yml file:"
echo "   - VITE_API_URL=http://your-server-ip:port/api"
echo "   - VITE_BACKEND_URL=http://your-server-ip:port"
echo ""
echo "4. Use Container Station or Docker to deploy the stack"
echo "5. Access your application at the configured port"
echo ""
echo "Usage examples:"
echo "  # Build both platforms with latest tags:"
echo "  ./build-and-push.sh"
echo ""
echo "  # Build both platforms with version tags:"
echo "  ./build-and-push.sh 1.6.43" 