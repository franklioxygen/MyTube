#!/bin/bash
set -e

DOCKER_PATH="docker"
USERNAME="franklioxygen"
VERSION=$1

# Default build arguments (can be overridden by environment variables)
VITE_API_URL=${VITE_API_URL:-"http://localhost:5551/api"}
VITE_BACKEND_URL=${VITE_BACKEND_URL:-"http://localhost:5551"}

# Define platforms to build (comma-separated for buildx)
PLATFORMS="linux/amd64,linux/arm64"

# Ensure Docker is running
echo "🔍 Checking if Docker is running..."
$DOCKER_PATH ps > /dev/null 2>&1 || { echo "❌ Docker is not running. Please start Docker and try again."; exit 1; }
echo "✅ Docker is running!"

# Ensure buildx builder is available
echo "🔍 Setting up Docker Buildx builder..."
$DOCKER_PATH buildx inspect mytubebuilder > /dev/null 2>&1 || \
  $DOCKER_PATH buildx create --name mytubebuilder --use
$DOCKER_PATH buildx use mytubebuilder
$DOCKER_PATH buildx inspect --bootstrap
echo "✅ Buildx builder ready!"

# Build tag arguments for backend
BACKEND_TAGS="-t $USERNAME/mytube:backend-latest"
if [ -n "$VERSION" ]; then
  echo "🔖 Version specified: $VERSION"
  BACKEND_TAGS="$BACKEND_TAGS -t $USERNAME/mytube:backend-$VERSION"
fi

# Build tag arguments for frontend
FRONTEND_TAGS="-t $USERNAME/mytube:frontend-latest"
if [ -n "$VERSION" ]; then
  FRONTEND_TAGS="$FRONTEND_TAGS -t $USERNAME/mytube:frontend-$VERSION"
fi

echo ""
echo "🏗️ Building multi-architecture images using buildx..."
echo "Platforms: $PLATFORMS"
echo ""

# Build and push backend (multi-arch, single step)
echo "🏗️ Building and pushing backend..."
$DOCKER_PATH buildx build \
  --platform $PLATFORMS \
  -f backend/Dockerfile \
  $BACKEND_TAGS \
  --push \
  .

echo ""

# Build and push frontend (multi-arch, single step)
echo "🏗️ Building and pushing frontend..."
$DOCKER_PATH buildx build \
  --platform $PLATFORMS \
  --build-arg VITE_API_URL="$VITE_API_URL" \
  --build-arg VITE_BACKEND_URL="$VITE_BACKEND_URL" \
  $FRONTEND_TAGS \
  --push \
  frontend

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
echo "To deploy to your server or QNAP Container Station:"
echo "1. Use the multi-arch tags in docker-compose.yml (recommended):"
echo "   - Docker will automatically select the correct architecture"
echo "   - Example: franklioxygen/mytube:backend-latest"
echo ""
echo "2. Set environment variables in your docker-compose.yml file:"
echo "   - VITE_API_URL=http://your-server-ip:port/api"
echo "   - VITE_BACKEND_URL=http://your-server-ip:port"
echo ""
echo "Usage examples:"
echo "  # Build both platforms with latest tags:"
echo "  ./build-and-push.sh"
echo ""
echo "  # Build both platforms with version tags:"
echo "  ./build-and-push.sh 1.6.43"
echo ""
echo "🕐 Build completed at: $(date '+%Y-%m-%d %H:%M:%S %Z')"
