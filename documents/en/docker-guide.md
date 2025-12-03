# Docker Deployment Guide for MyTube

This guide provides step-by-step instructions to deploy [MyTube](https://github.com/franklioxygen/MyTube "null") using Docker and Docker Compose. This setup is designed for standard environments (Linux, macOS, Windows) and modifies the original QNAP-specific configurations for general use.

## 🚀 Quick Start (Pre-built Images)

The easiest way to run MyTube is using the official pre-built images.

### 1. Create a Project Directory

Create a folder for your project and navigate into it:

```
mkdir mytube-deploy
cd mytube-deploy
```

### 2. Create the `docker-compose.yml`

Create a file named `docker-compose.yml` inside your folder and paste the following content.

**Note:** This version uses standard relative paths (`./data`, `./uploads`) instead of the QNAP-specific paths found in the original repository.

```
version: '3.8'

services:
  backend:
    image: franklioxygen/mytube:backend-latest
    container_name: mytube-backend
    pull_policy: always
    restart: unless-stopped
    ports:
      - "5551:5551"
    environment:
      - PORT=5551
      # Optional: Set a custom upload directory inside container if needed
      # - VIDEO_DIR=/app/uploads/videos
    volumes:
      - ./uploads:/app/uploads
      - ./data:/app/data
    networks:
      - mytube-network

  frontend:
    image: franklioxygen/mytube:frontend-latest
    container_name: mytube-frontend
    pull_policy: always
    restart: unless-stopped
    ports:
      - "5556:5556"
    environment:
      # Internal Docker networking URLs (Browser -> Frontend -> Backend)
      # In most setups, these defaults work fine.
      - VITE_API_URL=/api
      - VITE_BACKEND_URL=
    depends_on:
      - backend
    networks:
      - mytube-network

networks:
  mytube-network:
    driver: bridge
```

### 3. Start the Application

Run the following command to start the services in the background:

```
docker-compose up -d
```

### 4. Access MyTube

Once the containers are running, access the application in your browser:

- **Frontend UI:** `http://localhost:5556`
    
- **Backend API:** `http://localhost:5551`
    

## ⚙️ Configuration & Data Persistence

### Volumes (Data Storage)

The `docker-compose.yml` above creates two folders in your current directory to persist data:

- `./uploads`: Stores downloaded videos and thumbnails.
    
- `./data`: Stores the SQLite database and logs.
    

**Important:** If you move the `docker-compose.yml` file, you must move these folders with it to keep your data.

### Environment Variables

You can customize the deployment by adding a `.env` file or modifying the `environment` section in `docker-compose.yml`.

|Variable|Service|Description|Default|
|---|---|---|---|
|`PORT`|Backend|Port the backend listens on internally|`5551`|
|`VITE_API_URL`|Frontend|API endpoint path|`/api`|
|`API_HOST`|Frontend|**Advanced:** Force a specific backend IP|_(Auto-detected)_|
|`API_PORT`|Frontend|**Advanced:** Force a specific backend Port|`5551`|

## 🛠️ Advanced Networking (Remote/NAS Deployment)

If you are deploying this on a remote server (e.g., a VPS or NAS) and accessing it from a different computer, the default relative API paths usually work fine.

However, if you experience connection issues where the frontend cannot reach the backend, you may need to explicitly tell the frontend where the API is located.

1. Create a `.env` file in the same directory as `docker-compose.yml`:
    
    ```
    API_HOST=192.168.1.100  # Replace with your server's LAN/WAN IP
    API_PORT=5551
    ```
    
2. Restart the containers:
    
    ```
    docker-compose down
    docker-compose up -d
    ```
    

## 🏗️ Building from Source (Optional)

If you prefer to build the images yourself (e.g., to modify code), follow these steps:

1. **Clone the Repository:**
    
    ```
    git clone [https://github.com/franklioxygen/MyTube.git](https://github.com/franklioxygen/MyTube.git)
    cd MyTube
    ```
    
2. **Build and Run:** You can use the same `docker-compose.yml` structure, but replace `image: ...` with `build: ...`.
    
    Modify `docker-compose.yml`:
    
    ```
    services:
      backend:
        build: ./backend
        # ... other settings
      frontend:
        build: ./frontend
        # ... other settings
    ```
    
3. **Start:**
    
    ```
    docker-compose up -d --build
    ```
    

## ❓ Troubleshooting

### 1. "Network Error" or API connection failed

- **Cause:** The browser cannot reach the backend API.
    
- **Fix:** Ensure port `5551` is open on your firewall. If running on a remote server, try setting the `API_HOST` in a `.env` file as described in the "Advanced Networking" section.
    

### 2. Permission Denied for `./uploads`

- **Cause:** The Docker container user doesn't have write permissions to the host directory.
    
- **Fix:** Adjust permissions on your host machine:
    
    ```
    chmod -R 777 ./uploads ./data
    ```
    

### 3. Container Name Conflicts

- **Cause:** You have another instance of MyTube running or an old container wasn't removed.
    
- **Fix:** Remove old containers before starting:
    
    ```
    docker rm -f mytube-backend mytube-frontend
    docker-compose up -d
    ```