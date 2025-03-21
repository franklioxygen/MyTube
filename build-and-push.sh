#!/bin/bash
set -e

DOCKER_PATH="/Applications/Docker.app/Contents/Resources/bin/docker"
USERNAME="franklioxygen"
BACKEND_IMAGE="$USERNAME/mytube:backend-latest"
FRONTEND_IMAGE="$USERNAME/mytube:frontend-latest"

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
$DOCKER_PATH build --no-cache --platform linux/amd64 -t $BACKEND_IMAGE .
cd ..

# Build frontend image with no-cache to force rebuild
echo "🏗️ Building frontend image with default localhost configuration..."
cd frontend
$DOCKER_PATH build --no-cache --platform linux/amd64 \
  --build-arg VITE_API_URL="$VITE_API_URL" \
  --build-arg VITE_BACKEND_URL="$VITE_BACKEND_URL" \
  -t $FRONTEND_IMAGE .
cd ..

# Push images to Docker Hub
echo "🚀 Pushing images to Docker Hub..."
$DOCKER_PATH push $BACKEND_IMAGE
$DOCKER_PATH push $FRONTEND_IMAGE

echo "✅ Successfully built and pushed images to Docker Hub!"
echo "Backend image: $BACKEND_IMAGE"
echo "Frontend image: $FRONTEND_IMAGE"
echo ""
echo "To deploy to your server or QNAP Container Station:"
echo "1. Upload the docker-compose.yml file to your server"
echo "2. Set environment variables in your docker-compose.yml file:"
echo "   - VITE_API_URL=http://your-server-ip:port/api"
echo "   - VITE_BACKEND_URL=http://your-server-ip:port"
echo "3. Use Container Station or Docker to deploy the stack using this compose file"
echo "4. Access your application at the configured port" 