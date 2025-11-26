#!/bin/bash
set -e

DOCKER_PATH="/Applications/Docker.app/Contents/Resources/bin/docker"
USERNAME="franklioxygen"
VERSION=$1

BACKEND_LATEST="$USERNAME/mytube:backend-latest"
FRONTEND_LATEST="$USERNAME/mytube:frontend-latest"

if [ -n "$VERSION" ]; then
  echo "🔖 Version specified: $VERSION"
  BACKEND_VERSION_TAG="$USERNAME/mytube:backend-$VERSION"
  FRONTEND_VERSION_TAG="$USERNAME/mytube:frontend-$VERSION"
fi

# Default build arguments (can be overridden by environment variables)
VITE_API_URL=${VITE_API_URL:-"http://localhost:5551/api"}
VITE_BACKEND_URL=${VITE_BACKEND_URL:-"http://localhost:5551"}

# Ensure Docker is running
echo "🔍 Checking if Docker is running..."
$DOCKER_PATH ps > /dev/null 2>&1 || { echo "❌ Docker is not running. Please start Docker and try again."; exit 1; }
echo "✅ Docker is running!"

# Build backend image with no-cache to force rebuild
echo "🏗️ Building backend image..."
cd backend
$DOCKER_PATH build --no-cache --platform linux/amd64 -t $BACKEND_LATEST .
if [ -n "$VERSION" ]; then
  $DOCKER_PATH tag $BACKEND_LATEST $BACKEND_VERSION_TAG
fi
cd ..

# Build frontend image with no-cache to force rebuild
echo "🏗️ Building frontend image with default localhost configuration..."
cd frontend
$DOCKER_PATH build --no-cache --platform linux/amd64 \
  --build-arg VITE_API_URL="$VITE_API_URL" \
  --build-arg VITE_BACKEND_URL="$VITE_BACKEND_URL" \
  -t $FRONTEND_LATEST .

if [ -n "$VERSION" ]; then
  $DOCKER_PATH tag $FRONTEND_LATEST $FRONTEND_VERSION_TAG
fi
cd ..

# Push images to Docker Hub
echo "🚀 Pushing images to Docker Hub..."
$DOCKER_PATH push $BACKEND_LATEST
$DOCKER_PATH push $FRONTEND_LATEST

if [ -n "$VERSION" ]; then
  echo "🚀 Pushing versioned images..."
  $DOCKER_PATH push $BACKEND_VERSION_TAG
  $DOCKER_PATH push $FRONTEND_VERSION_TAG
fi

echo "✅ Successfully built and pushed images to Docker Hub!"
echo "Backend image: $BACKEND_LATEST"
echo "Frontend image: $FRONTEND_LATEST"
if [ -n "$VERSION" ]; then
  echo "Backend version: $BACKEND_VERSION_TAG"
  echo "Frontend version: $FRONTEND_VERSION_TAG"
fi
echo ""
echo "To deploy to your server or QNAP Container Station:"
echo "1. Upload the docker-compose.yml file to your server"
echo "2. Set environment variables in your docker-compose.yml file:"
echo "   - VITE_API_URL=http://your-server-ip:port/api"
echo "   - VITE_BACKEND_URL=http://your-server-ip:port"
echo "3. Use Container Station or Docker to deploy the stack using this compose file"
echo "4. Access your application at the configured port" 