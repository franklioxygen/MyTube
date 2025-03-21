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

Use the provided script to build and push the Docker images to Docker Hub:

```bash
# Make the script executable
chmod +x build-and-push.sh

# Run the script
./build-and-push.sh
```

The script will:

- Build the backend and frontend Docker images optimized for amd64 architecture
- Push the images to Docker Hub under your account (franklioxygen)

### 2. Configure Environment Variables

The docker-compose.yml file uses environment variables that should be set according to your specific deployment environment:

#### a) Setting Environment Variables Directly

Before deploying, you can export the variables in your shell:

```bash
export API_URL=http://your-server-ip:5551/api
export BACKEND_URL=http://your-server-ip:5551
```

#### b) Using .env File

Alternatively, create a `.env` file in the same directory as your docker-compose.yml with the following content:

```
API_URL=http://your-server-ip:5551/api
BACKEND_URL=http://your-server-ip:5551
```

Replace `your-server-ip` with your actual server IP address or hostname.

### 3. Deploy on Server or QNAP Container Station

#### For Generic Server with Docker Compose:

```bash
docker-compose up -d
```

#### For QNAP Container Station:

1. Copy the `docker-compose.yml` file to your QNAP NAS
2. If using the .env approach, copy the .env file as well
3. Open Container Station on your QNAP
4. Navigate to the "Applications" tab
5. Click on "Create" and select "Create from YAML"
6. Upload the `docker-compose.yml` file or paste its contents
7. Click "Create" to deploy the application

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

### 4. Access the Application

Once deployed:

- Frontend will be accessible at: http://your-server-ip:5556
- Backend API will be accessible at: http://your-server-ip:5551/api

## Volume Persistence

The Docker Compose setup includes a volume mount for the backend to store downloaded videos:

```yaml
volumes:
  backend-data:
    driver: local
```

This ensures that your downloaded videos are persistent even if the container is restarted.

## Network Configuration

The services are connected through a dedicated bridge network called `mytube-network`.

## Environment Variables

The Docker images now use configurable environment variables with sensible defaults:

### Frontend

- `VITE_API_URL`: Defaults to http://localhost:5551/api if not set
- `VITE_BACKEND_URL`: Defaults to http://localhost:5551 if not set

### Backend

- `PORT`: 5551

## Troubleshooting

If you encounter issues:

1. Check if the Docker images were successfully pushed to Docker Hub
2. Verify that your server or Container Station has internet access to pull the images
3. Check the logs for any deployment errors with `docker-compose logs`
4. Ensure ports 5551 and 5556 are not being used by other services
5. Verify that the environment variables are correctly set
6. If backend fails with Python-related errors, verify that the container has Python installed
