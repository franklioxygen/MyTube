# Docker Deployment Guide for MyTube

This guide provides step-by-step instructions to deploy [MyTube](https://github.com/franklioxygen/MyTube "null") using Docker and Docker Compose. The repository includes QNAP-oriented compose files; update the volume paths to match your environment or use the sample below.

> [!NOTE]
> **Multi-Architecture Support:** The official images support both **amd64** (x86_64) and **arm64** (Apple Silicon, Raspberry Pi, etc.) architectures. Docker will automatically pull the correct image for your system.
>
> **Official GitHub Container Image:** `ghcr.io/franklioxygen/mytube:latest` (published by this repository's GitHub Actions workflow).
>
> **Image Size Note:** Backend images include the Deno runtime for yt-dlp JavaScript runtime support, which adds roughly ~90MB to image size.

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

**Note:** This version uses standard relative paths (`./data`, `./uploads`). If you copy the repo’s `docker-compose.yml`, update the volume paths to match your host.

```yaml
services:
  backend:
    image: franklioxygen/mytube:backend-latest
    container_name: mytube-backend
    pull_policy: always
    restart: unless-stopped
    ports:
      - "5551:5551"
    networks:
      - mytube-network
    environment:
      - PORT=5551
    volumes:
      - ./uploads:/app/uploads
      - ./data:/app/data
    # For OpenWrt/iStoreOS systems where bridge network cannot access internet,
    # uncomment the following lines to use host network mode:
    # network_mode: host
    # Then set NGINX_BACKEND_URL=http://localhost:5551 for frontend service

  frontend:
    image: franklioxygen/mytube:frontend-latest
    container_name: mytube-frontend
    pull_policy: always
    restart: unless-stopped
    ports:
      - "5556:5556"
    depends_on:
      - backend
    networks:
      - mytube-network
    environment:
      # Internal Docker networking URLs (Browser -> Frontend -> Backend)
      # In most setups, these defaults work fine.
      - VITE_API_URL=/api
      - VITE_BACKEND_URL=
      # For host network mode (when backend uses network_mode: host), set:
      # - NGINX_BACKEND_URL=http://localhost:5551
    # If backend uses host network mode, uncomment the following:
    # network_mode: host
    # And remove the ports mapping above

networks:
  mytube-network:
    driver: bridge
    # DNS configuration to help with network connectivity issues on OpenWrt/iStoreOS
    # If you still have issues accessing internet from containers, try:
    # 1. Add your router's DNS servers: dns: [8.8.8.8, 8.8.4.4]
    # 2. Or use host network mode for backend (see comments above)
    driver_opts:
      com.docker.network.bridge.enable_ip_masquerade: "true"
      com.docker.network.bridge.enable_icc: "true"
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
    
## 🧩 Single-Container Mode (Frontend + Backend in One Container)

If you prefer a single container, use the backend-integrated image published to GHCR. This image already includes the built frontend static assets.

You can run the compose file included in this repository:

```
docker-compose -f docker-compose.single-container.yml up -d
```

Or use an equivalent standalone compose file:

```yaml
services:
  mytube:
    image: ghcr.io/franklioxygen/mytube:latest
    container_name: mytube
    pull_policy: always
    restart: unless-stopped
    ports:
      - "5551:5551"
    environment:
      - PORT=5551
    volumes:
      - ./uploads:/app/uploads
      - ./data:/app/data
```

Access both frontend and API through the same port:

- **Frontend UI:** `http://localhost:5551`
- **Backend API:** `http://localhost:5551/api`


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
|`NGINX_BACKEND_URL`|Frontend|**Advanced:** Override Nginx backend upstream URL|`http://backend:5551`|

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
    git clone https://github.com/franklioxygen/MyTube.git
    cd MyTube
    ```
    
2. **Build and Run:** You can use the same `docker-compose.yml` structure, but replace `image: ...` with `build: ...`.
    
    Modify `docker-compose.yml`:
    
    ```yaml
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

### 4. Connection Refused / No Internet (OpenWrt/iStoreOS)

- **Cause:** Docker bridge network compatibility issues on some router OS versions.
- **Fix:** We added `driver_opts` to the default network configuration to address this. If issues persist:
    1.  Edit `docker-compose.yml`.
    2.  Uncomment `network_mode: host` for both `backend` and `frontend`.
    3.  Remove (or comment out) the `ports` and `networks` sections for both services.
    4.  Set `NGINX_BACKEND_URL=http://localhost:5551` in the `frontend` environment variables.
    5.  Restart containers: `docker-compose up -d`

Alternatively, the repo includes `docker-compose.host-network.yml` for host-network deployments:

```
docker-compose -f docker-compose.host-network.yml up -d
```

For unified frontend+backend deployment, the repo also includes:

```
docker-compose -f docker-compose.single-container.yml up -d
```
