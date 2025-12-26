#!/bin/bash
set -e

# Default values from build time
DEFAULT_API_URL="http://localhost:5551/api"
DEFAULT_BACKEND_URL="http://localhost:5551"

# Determine backend URL for nginx configuration
# Priority: NGINX_BACKEND_URL > API_HOST > VITE_BACKEND_URL > default (backend:5551)
if [ ! -z "$NGINX_BACKEND_URL" ]; then
  # Direct override for nginx backend URL (useful for host network mode)
  NGINX_BACKEND="${NGINX_BACKEND_URL}"
  echo "Using NGINX_BACKEND_URL: $NGINX_BACKEND"
elif [ ! -z "$API_HOST" ]; then
  # Custom host configuration
  API_PORT="${API_PORT:-5551}"
  NGINX_BACKEND="http://${API_HOST}:${API_PORT}"
  echo "Using custom host configuration: $API_HOST:$API_PORT"
elif [ ! -z "$VITE_BACKEND_URL" ]; then
  # Use VITE_BACKEND_URL if provided
  NGINX_BACKEND="${VITE_BACKEND_URL}"
  echo "Using VITE_BACKEND_URL: $NGINX_BACKEND"
else
  # Default: use service name for bridge network
  NGINX_BACKEND="http://backend:5551"
  echo "Using default backend service name: backend:5551"
fi

# Runtime values from docker-compose environment variables for JavaScript
DOCKER_API_URL="${VITE_API_URL-http://backend:5551/api}"
DOCKER_BACKEND_URL="${VITE_BACKEND_URL-http://backend:5551}"

# If API_HOST is provided, override JavaScript URLs
if [ ! -z "$API_HOST" ]; then
  API_PORT="${API_PORT:-5551}"
  DOCKER_API_URL="http://${API_HOST}:${API_PORT}/api"
  DOCKER_BACKEND_URL="http://${API_HOST}:${API_PORT}"
fi

echo "Configuring frontend with the following settings:"
echo "API URL (JS): $DOCKER_API_URL"
echo "Backend URL (JS): $DOCKER_BACKEND_URL"
echo "Backend URL (Nginx): $NGINX_BACKEND"

# Replace backend URL placeholder in nginx.conf
ESCAPED_NGINX_BACKEND=$(echo $NGINX_BACKEND | sed 's/\//\\\//g')
sed -i "s/__BACKEND_URL__/$ESCAPED_NGINX_BACKEND/g" /etc/nginx/conf.d/default.conf
echo "Updated nginx.conf with backend URL: $NGINX_BACKEND"

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