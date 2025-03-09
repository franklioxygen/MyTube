# Deployment Guide for MyTube

This guide explains how to deploy MyTube to a QNAP Container Station.

## Prerequisites

- Docker Hub account
- QNAP NAS with Container Station installed
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

### 2. Deploy on QNAP Container Station

1. Copy the `docker-compose.yml` file to your QNAP NAS
2. Open Container Station on your QNAP
3. Navigate to the "Applications" tab
4. Click on "Create" and select "Create from YAML"
5. Upload the `docker-compose.yml` file or paste its contents
6. Click "Create" to deploy the application

#### Volume Paths on QNAP

The docker-compose file is configured to use the following specific paths on your QNAP:

```yaml
volumes:
  - /share/CACHEDEV2_DATA/Medias/MyTube/uploads:/app/uploads
  - /share/CACHEDEV2_DATA/Medias/MyTube/data:/app/data
```

Ensure these directories exist on your QNAP before deployment. If they don't exist, create them:

```bash
mkdir -p /share/CACHEDEV2_DATA/Medias/MyTube/uploads
mkdir -p /share/CACHEDEV2_DATA/Medias/MyTube/data
```

### 3. Access the Application

Once deployed:

- Frontend will be accessible at: http://192.168.1.105:5556
- Backend API will be accessible at: http://192.168.1.105:5551/api

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

The Docker images have been configured with the following default environment variables:

### Frontend

- `VITE_API_URL`: http://192.168.1.105:5551/api
- `VITE_BACKEND_URL`: http://192.168.1.105:5551

### Backend

- `PORT`: 5551

## Troubleshooting

If you encounter issues:

1. Check if the Docker images were successfully pushed to Docker Hub
2. Verify that Container Station has internet access to pull the images
3. Check Container Station logs for any deployment errors
4. Ensure ports 5551 and 5556 are not being used by other services on your QNAP
5. If backend fails with Python-related errors, verify that the container has Python installed
