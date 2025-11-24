#!/bin/bash
set -e

# Default values from build time
DEFAULT_API_URL="http://localhost:5551/api"
DEFAULT_BACKEND_URL="http://localhost:5551"

# Runtime values from docker-compose environment variables
DOCKER_API_URL="${VITE_API_URL-http://backend:5551/api}"
DOCKER_BACKEND_URL="${VITE_BACKEND_URL-http://backend:5551}"

# If API_HOST is provided, override with custom host configuration
if [ ! -z "$API_HOST" ]; then
  API_PORT="${API_PORT:-5551}"
  DOCKER_API_URL="http://${API_HOST}:${API_PORT}/api"
  DOCKER_BACKEND_URL="http://${API_HOST}:${API_PORT}"
  echo "Using custom host configuration: $API_HOST:$API_PORT"
fi

echo "Configuring frontend with the following settings:"
echo "API URL: $DOCKER_API_URL"
echo "Backend URL: $DOCKER_BACKEND_URL"

# Replace environment variables in the JavaScript files
# We need to escape special characters for sed
ESCAPED_DEFAULT_API_URL=$(echo $DEFAULT_API_URL | sed 's/\//\\\//g')
ESCAPED_API_URL=$(echo $DOCKER_API_URL | sed 's/\//\\\//g')
ESCAPED_DEFAULT_BACKEND_URL=$(echo $DEFAULT_BACKEND_URL | sed 's/\//\\\//g')
ESCAPED_BACKEND_URL=$(echo $DOCKER_BACKEND_URL | sed 's/\//\\\//g')

echo "Replacing $DEFAULT_API_URL with $DOCKER_API_URL in JavaScript files..."
find /usr/share/nginx/html -type f -name "*.js" -exec sed -i "s/$ESCAPED_DEFAULT_API_URL/$ESCAPED_API_URL/g" {} \;

echo "Replacing $DEFAULT_BACKEND_URL with $DOCKER_BACKEND_URL in JavaScript files..."
find /usr/share/nginx/html -type f -name "*.js" -exec sed -i "s/$ESCAPED_DEFAULT_BACKEND_URL/$ESCAPED_BACKEND_URL/g" {} \;

echo "Environment variable substitution completed."

# Execute CMD
exec "$@" 