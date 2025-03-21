# Deployment Guide for MyTube

This guide explains how to deploy MyTube to a server or QNAP Container Station.

## Prerequisites

- Docker Hub account
- Server with Docker and Docker Compose installed, or QNAP NAS with Container Station installed
- Docker installed on your development machine

## Docker Images

The application is containerized into two Docker images:

1. Frontend: `franklioxygen/mytube:frontend-latest`
2. Backend: `franklioxygen/mytube:backend-latest`

## Deployment Process

### 1. Build and Push Docker Images

You can customize the build configuration by setting environment variables before running the build script:

```bash
# Optional: Set custom API URLs for the build (defaults to localhost if not set)
export VITE_API_URL="http://your-build-server:5551/api"
export VITE_BACKEND_URL="http://your-build-server:5551"

# Make the script executable
chmod +x build-and-push.sh

# Run the script
./build-and-push.sh
```

The script will:

- Build the backend and frontend Docker images optimized for amd64 architecture
- Apply the specified environment variables during build time (or use localhost defaults)
- Push the images to Docker Hub under your account (franklioxygen)

### 2. Deploy on Server or QNAP Container Station

#### For Standard Docker Environment:

By default, the docker-compose.yml is configured to use Docker's service discovery for container communication:

```bash
docker-compose up -d
```

#### For QNAP Container Station or Environments with Networking Limitations:

If you're deploying to QNAP or another environment where container-to-container communication via service names doesn't work properly, you'll need to specify the host IP:

1. Create a `.env` file with your server's IP:

```
API_HOST=your-server-ip
API_PORT=5551
```

2. Place this file in the same directory as your docker-compose.yml
3. Deploy using Container Station or docker-compose:

```bash
docker-compose up -d
```

#### Volume Paths on QNAP

The docker-compose file is configured to use the following specific paths on your QNAP:

```yaml
volumes:
  - /share/CACHEDEV2_DATA/Medias/MyTube/uploads:/app/uploads
  - /share/CACHEDEV2_DATA/Medias/MyTube/data:/app/data
```

Ensure these directories exist on your server or QNAP before deployment. If they don't exist, create them:

```bash
mkdir -p /share/CACHEDEV2_DATA/Medias/MyTube/uploads
mkdir -p /share/CACHEDEV2_DATA/Medias/MyTube/data
```

If deploying to a different server (not QNAP), you may want to modify these paths in the docker-compose.yml file.

### 3. Access the Application

Once deployed:

- Frontend will be accessible at: http://your-server-ip:5556
- Backend API will be accessible at: http://your-server-ip:5551/api

## Docker Networking and Environment Variables

### Container Networking Options

The application provides two ways for containers to communicate with each other:

#### 1. Docker Service Discovery (Default)

In standard Docker environments, containers can communicate using service names. This is the default configuration:

```yaml
environment:
  - VITE_API_URL=http://backend:5551/api
  - VITE_BACKEND_URL=http://backend:5551
```

This works for most Docker environments including Docker Desktop, Docker Engine on Linux, and many managed container services.

#### 2. Custom Host Configuration (For QNAP and Special Cases)

For environments where service discovery doesn't work properly, you can specify a custom host:

```
# In .env file:
API_HOST=192.168.1.105
API_PORT=5551
```

The entrypoint script will detect these variables and configure the frontend to use the specified host and port.

### How Environment Variables Work

This application handles environment variables in three stages:

1. **Build-time configuration** (via ARG in Dockerfile):

   - Default values are set to `http://localhost:5551/api` and `http://localhost:5551`
   - These values are compiled into the frontend application

2. **Container start-time configuration** (via entrypoint.sh):

   - The entrypoint script replaces the build-time URLs with runtime values
   - Uses either service name (backend) or custom host (API_HOST) as configured
   - This happens every time the container starts, so no rebuild is needed

3. **Priority order**:
   - If API_HOST is provided → Use that explicitly
   - If not, use VITE_API_URL from docker-compose → Service discovery with "backend"
   - If neither is available → Fall back to default localhost values

## Volume Persistence

The Docker Compose setup includes a volume mount for the backend to store downloaded videos:

```yaml
volumes:
  backend-data:
    driver: local
```

This ensures that your downloaded videos are persistent even if the container is restarted.

## Network Configuration

The services are connected through a dedicated bridge network called `mytube-network`, which enables service discovery by name.

## Troubleshooting

If you encounter issues:

1. **Network Errors**:

   - If you're using Docker service discovery and get connection errors, try using the custom host method
   - Create a .env file with API_HOST=your-server-ip and API_PORT=5551
   - Check if both containers are running: `docker ps`
   - Verify they're on the same network: `docker network inspect mytube-network`
   - Check logs for both containers: `docker logs mytube-frontend` and `docker logs mytube-backend`

2. **Checking the Applied Configuration**:

   - You can verify what URLs the frontend is using with: `docker logs mytube-frontend`
   - The entrypoint script will show "Configuring frontend with the following settings:"

3. **General Troubleshooting**:
   - Ensure ports 5551 and 5556 are not being used by other services
   - Check for any deployment errors with `docker-compose logs`
   - If backend fails with Python-related errors, verify that the container has Python installed
