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

If you want to use the repository-provided default stack directly, run:

```bash
docker-compose -f stacks/docker-compose.yml up -d
```

### 1. Create a Project Directory

Create a folder for your project and navigate into it:

```
mkdir mytube-deploy
cd mytube-deploy
```

### 2. Create the `docker-compose.yml`

Create a file named `docker-compose.yml` inside your folder and paste the following content.

**Note:** This version uses standard relative paths (`./data`, `./uploads`). If you copy the repo’s `stacks/docker-compose.yml`, update the volume paths to match your host.

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
      # Optional: run the backend as the same uid/gid as the host-side files.
      - PUID=${PUID:-1000}
      - PGID=${PGID:-1000}
      # Optional: disable the startup chown pass for bind mounts by setting 0.
      - MYTUBE_AUTO_FIX_PERMISSIONS=${MYTUBE_AUTO_FIX_PERMISSIONS:-1}
      # Optional: declare the admin trust boundary for this deployment.
      # Valid values: application | container | host
      - MYTUBE_ADMIN_TRUST_LEVEL=container
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
docker-compose -f stacks/docker-compose.single-container.yml up -d
```

By default, this stack keeps using the current host paths `../uploads` and `../data`
(relative to `stacks/`, meaning the repo-root `uploads/` and `data/` folders).
If you want a cleaner repo root or want to co-locate data with the backend folder,
override the host paths when starting compose:

```bash
MYTUBE_UPLOADS_DIR=../backend/uploads \
MYTUBE_DATA_DIR=../backend/data \
docker-compose -f stacks/docker-compose.single-container.yml up -d
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
      - PUID=${PUID:-1000}
      - PGID=${PGID:-1000}
      - MYTUBE_AUTO_FIX_PERMISSIONS=${MYTUBE_AUTO_FIX_PERMISSIONS:-1}
    volumes:
      - ${MYTUBE_UPLOADS_DIR:-./uploads}:/app/uploads
      - ${MYTUBE_DATA_DIR:-./data}:/app/data
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

For the repo-provided single-container stack under `stacks/`, you can override the
host-side paths with `MYTUBE_UPLOADS_DIR` and `MYTUBE_DATA_DIR` without breaking
existing users who still rely on the default repo-root directories.

For new installs, consider keeping `uploads` as a bind mount but switching `/app/data` to a Docker named volume. SQLite is more reliable there because it avoids host filesystem ownership and ACL edge cases.

Example backend volume section:

```yaml
    volumes:
      - ./uploads:/app/uploads
      - mytube-data:/app/data
```

### Updating yt-dlp without rebuilding

Settings -> yt-dlp Configuration shows the yt-dlp version the backend actually
runs and, on `container` admin trust, offers an **Update yt-dlp** button.

Runtime updates no longer run `pip install -U` against the image Python
environment or a `--user` site. MyTube installs each update into a new
immutable directory under `/app/data/ytdlp/releases/` and only then atomically
replaces `/app/data/ytdlp/current.json`. Downloads that already started keep
using their original release; new jobs pick up the published one.

The managed store lives on the `/app/data` volume, so it survives
`docker compose down && up`, container recreation, and image upgrades.

Each release is a self-contained package directory of roughly 50-100 MB. MyTube
keeps the current release plus the two before it so a rollback is always
possible, and deletes older ones automatically once no download is still using
them. Budget a few hundred MB under `/app/data/ytdlp` on a long-lived install.

For a managed release, the path shown in Settings is the Python interpreter
MyTube runs (`<python> -m yt_dlp`), not a `yt-dlp` executable. That is expected:
the release is a package directory, not a standalone binary. When `YT_DLP_PATH`
is set, or when no managed release exists yet, Settings shows that executable
instead.

**Recreating from an older image is not a rollback.** `current.json` still
points at the last published managed release. To return to the image-pinned
binary:

1. Pin the image binary **before** deleting the store:

```yaml
environment:
  - YT_DLP_PATH=/usr/local/bin/yt-dlp
```

An absolute `YT_DLP_PATH` is treated as operator-managed: MyTube will not
auto-upgrade it and the **Update yt-dlp** button stays disabled.
`YT_DLP_PATH=yt-dlp` is not a hard pin.

2. Stop the service, then delete the managed store (this does not delete the
database or media):

Deleting the store from inside a *running* backend removes yt-dlp modules that
a download in progress may still be using, and a request arriving in the gap can
recreate the store before the pinned `YT_DLP_PATH` takes effect. Stop first:

For the default two-container stack (`backend` service):

```bash
docker compose stop backend
docker compose run --rm --no-deps --entrypoint sh backend -c 'rm -rf /app/data/ytdlp'
```

For the supplied single-container stack (`mytube` service):

```bash
docker compose -f stacks/docker-compose.single-container.yml stop mytube
docker compose -f stacks/docker-compose.single-container.yml run --rm --no-deps --entrypoint sh mytube -c 'rm -rf /app/data/ytdlp'
```

3. Recreate the service so Compose applies the new environment (a plain
`restart` does not apply Compose configuration changes):

```bash
# Default two-container stack
docker compose up -d --force-recreate backend

# Supplied single-container stack
docker compose -f stacks/docker-compose.single-container.yml up -d --force-recreate mytube
```

If you only want to drop a managed update and let MyTube rebuild a store from
PATH/image discovery (including stale auto-install), omit `YT_DLP_PATH` and
restart after deleting `/app/data/ytdlp`.

A leftover `/app/data/.home/.local` tree from older MyTube versions is unused
once a managed release is published (`PYTHONNOUSERSITE=1`). You may delete it
to reclaim disk, with the service stopped for the same reason as above:

```bash
docker compose stop backend
docker compose run --rm --no-deps --entrypoint sh backend -c 'rm -rf /app/data/.home/.local'
docker compose up -d backend
```

The bundled bgutil POT provider is not part of this update. Its Python plugin is
loaded from the image ahead of any pip copy, and its Node server ships with the
image, so bumping the provider requires a new image.

### Environment Variables

You can customize the deployment by adding a `.env` file or modifying the `environment` section in `docker-compose.yml`.

For the admin trust model, set:

```env
MYTUBE_ADMIN_TRUST_LEVEL=container
```

Available values:

- `application`: admin is trusted at the application layer only
- `container`: admin is trusted with backend/container-process-level actions
- `host`: admin is trusted with host-scoped administrative actions

For the full capability breakdown, see [Deployment Security Model](deployment-security-model.md).

|Variable|Service|Description|Default|
|---|---|---|---|
|`PORT`|Backend|Port the backend listens on internally|`5551`|
|`PUID`|Backend|UID used for the backend process after startup permission reconciliation|`1000`|
|`PGID`|Backend|GID used for the backend process after startup permission reconciliation|`1000`|
|`MYTUBE_AUTO_FIX_PERMISSIONS`|Backend|Whether the entrypoint should chown bind-mounted `data` and `uploads` before dropping privileges|`1`|
|`MYTUBE_ADMIN_TRUST_LEVEL`|Backend|Deployment-declared admin trust boundary (`application`, `container`, `host`)|`container`|
|`VITE_API_URL`|Frontend|API endpoint path|`/api`|
|`API_HOST`|Frontend|**Advanced:** Force a specific backend IP|_(Auto-detected)_|
|`API_PORT`|Frontend|**Advanced:** Force a specific backend Port|`5551`|
|`NGINX_BACKEND_URL`|Frontend|**Advanced:** Override Nginx backend upstream URL|`http://backend:5551`|

The backend container now starts as root only long enough to reconcile bind-mount ownership, then launches MyTube as `PUID:PGID` using `gosu`.

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
    

## 🔌 Deploying Behind a Reverse Proxy (WebSocket Support)

The **Live Translation** feature uses a **WebSocket** connection (`/api/live-translation/ws`). MyTube's built-in `frontend` container already proxies WebSocket upgrades to the backend, so **direct deployments work out of the box** — there is nothing to configure.

However, if you put **your own** reverse proxy in front of MyTube (Nginx Proxy Manager, Traefik, Caddy, a hand-written Nginx vhost, a Synology/QNAP reverse proxy, a Cloudflare Tunnel, etc.) to add TLS or a custom domain, that proxy **must forward the WebSocket upgrade**. This is a standard requirement for any app that uses WebSockets. If it is not enabled, the browser reports:

> WebSocket connection to 'wss://your-domain/api/live-translation/ws' failed: There was a bad response from the server.

Enable WebSocket passthrough on your proxy:

- **Nginx (hand-written vhost):** add the upgrade headers to the location that proxies MyTube.

    ```nginx
    location / {
        proxy_pass http://MYTUBE_FRONTEND_HOST:5556;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
    ```

- **Nginx Proxy Manager:** edit the Proxy Host → **Details** tab → toggle **Websockets Support** ON → Save.
- **Synology / QNAP reverse proxy:** in the rule's **Custom Header** section, add the **WebSocket** header preset (sets `Upgrade` / `Connection`).
- **Traefik / Caddy:** no extra config — both forward WebSocket upgrades automatically.
- **Cloudflare (proxied DNS / Tunnel):** WebSockets are supported by default; no change needed.

> [!TIP]
> Verify the path end-to-end with `curl`. A correctly proxied endpoint reaches the backend's upgrade handler and returns a **bare `401`** with an `X-Live-Translation-Error: ticket_missing` header (the missing-ticket case is expected for a raw curl). A **JSON `401` body**, an HTML page, or a `404` means a proxy in front stripped the upgrade.
>
> ```bash
> curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" \
>   -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
>   -H "Origin: https://your-domain" \
>   https://your-domain/api/live-translation/ws
> ```

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
    

### 2. Permission Denied for `./uploads` or `./data/mytube.db`

- **Cause:** The backend process uid/gid does not match the ownership of the bind-mounted host files, or the host filesystem blocks `chown`.
    
- **Fix:** First make sure `PUID`/`PGID` match the intended host owner. By default MyTube uses `1000:1000` and will try to reconcile permissions automatically at startup.

- **Fix:** If automatic reconciliation cannot fix the mount, adjust ownership on the host:
    
    ```
    chown -R 1000:1000 ./uploads ./data
    ```

- **Fix:** If your files are intentionally owned by a different user, set matching values in `.env` or `docker-compose.yml`:

    ```
    PUID=1001
    PGID=1001
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

Alternatively, the repo includes `stacks/docker-compose.host-network.yml` for host-network deployments:

```
docker-compose -f stacks/docker-compose.host-network.yml up -d
```

For unified frontend+backend deployment, the repo also includes:

```
docker-compose -f stacks/docker-compose.single-container.yml up -d
```

### 5. Live Translation fails with "bad response from the server" (WebSocket)

- **Cause:** A reverse proxy in front of MyTube is not forwarding the WebSocket upgrade for `/api/live-translation/ws`. This only affects deployments that add their own proxy (TLS termination, custom domain); the built-in `frontend` container already handles it.
- **Fix:** Enable WebSocket support on your proxy — see [Deploying Behind a Reverse Proxy (WebSocket Support)](#-deploying-behind-a-reverse-proxy-websocket-support).
