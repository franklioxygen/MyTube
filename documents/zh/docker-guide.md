# MyTube Docker 部署指南

本指南提供了使用 Docker 和 Docker Compose 部署  [MyTube](https://github.com/franklioxygen/MyTube "null")  的详细步骤。仓库中包含面向 QNAP 的 Compose 文件，请按需调整卷路径，或直接使用下面的通用示例。

> [!NOTE]
> **多架构支持：** 官方镜像支持 **amd64** (x86_64) 和 **arm64** (Apple Silicon, Raspberry Pi 等) 架构。Docker 会自动为您的系统拉取正确的镜像。
>
> **GitHub 官方容器镜像：** `ghcr.io/franklioxygen/mytube:latest`（由本仓库 GitHub Actions 自动发布）。
>
> **镜像体积说明：** 后端镜像包含用于 yt-dlp JavaScript 运行时支持的 Deno，镜像体积大约会增加 ~90MB。

## 🚀 快速开始 (使用预构建镜像)

运行 MyTube 最简单的方法是使用官方预构建的镜像。

如果你想直接使用仓库内置的默认 stack，可以运行：

```bash
docker-compose -f stacks/docker-compose.yml up -d
```

### 1. 创建项目目录

为您的项目创建一个文件夹并进入该目录：

```
mkdir mytube-deploy
cd mytube-deploy
```

### 2. 创建  `docker-compose.yml`  文件

在文件夹中创建一个名为  `docker-compose.yml`  的文件，并粘贴以下内容。

**注意：** 此版本使用标准相对路径（`./data`, `./uploads`）。若使用仓库内的 `stacks/docker-compose.yml`，请先调整卷路径。

```yaml
version: "3.8"

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
      # 可选：让后端进程使用与宿主机文件一致的 uid/gid。
      - PUID=${PUID:-1000}
      - PGID=${PGID:-1000}
      # 可选：设为 0 可禁用启动时对 bind mount 的 chown 过程。
      - MYTUBE_AUTO_FIX_PERMISSIONS=${MYTUBE_AUTO_FIX_PERMISSIONS:-1}
      # 可选：声明当前部署中管理员的信任边界。
      # 可选值：application | container | host
      - MYTUBE_ADMIN_TRUST_LEVEL=container
    volumes:
      - ./uploads:/app/uploads
      - ./data:/app/data
    # 对于 bridge 网络无法访问互联网的 OpenWrt/iStoreOS 系统，
    # 请取消注释以下行以使用主机网络模式：
    # network_mode: host
    # 然后为前端服务设置 NGINX_BACKEND_URL=http://localhost:5551

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
      # 内部 Docker 网络 URL（浏览器 -> 前端 -> 后端）
      # 在大多数设置中，这些默认值都可以正常工作。
      - VITE_API_URL=/api
      - VITE_BACKEND_URL=
      # 对于主机网络模式（当后端使用 network_mode: host 时），设置：
      # - NGINX_BACKEND_URL=http://localhost:5551
    # 如果后端使用主机网络模式，取消注释以下行：
    # network_mode: host
    # 并删除上面的 ports 映射

networks:
  mytube-network:
    driver: bridge
    # DNS 配置以帮助解决 OpenWrt/iStoreOS 上的网络连接问题
    # 如果您仍然遇到容器无法访问互联网的问题，请尝试：
    # 1. 添加路由器的 DNS 服务器：dns: [8.8.8.8, 8.8.4.4]
    # 2. 或者为后端使用主机网络模式（见上文注释）
    driver_opts:
      com.docker.network.bridge.enable_ip_masquerade: "true"
      com.docker.network.bridge.enable_icc: "true"
```

### 3. 启动应用

运行以下命令在后台启动服务：

```
docker-compose up -d
```

### 4. 访问 MyTube

容器运行后，请在浏览器中访问应用程序：

- **前端 UI:** `http://localhost:5556`
- **后端 API:** `http://localhost:5551`

## 🧩 单容器模式（前后端合一）

如果您希望只运行一个容器，可以使用发布到 GHCR 的一体化镜像。该镜像已包含前端构建产物。

可以直接使用仓库内置的 compose 文件：

```
docker-compose -f stacks/docker-compose.single-container.yml up -d
```

默认情况下，这个 stack 仍然使用当前的宿主机路径 `../uploads` 和 `../data`
（相对于 `stacks/`，也就是仓库根目录下的 `uploads/` 和 `data/`）。
如果你想让根目录更干净，或者希望把数据和 `backend/` 放在一起，
可以在启动时覆盖这两个路径：

```bash
MYTUBE_UPLOADS_DIR=../backend/uploads \
MYTUBE_DATA_DIR=../backend/data \
docker-compose -f stacks/docker-compose.single-container.yml up -d
```

或者使用等价的独立 compose 文件：

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

此模式下前端和 API 共用同一个端口：

- **前端 UI:** `http://localhost:5551`
- **后端 API:** `http://localhost:5551/api`

## ⚙️ 配置与数据持久化

### 卷 (数据存储)

上面的  `docker-compose.yml`  在当前目录中创建了两个文件夹来持久保存数据：

- `./uploads`: 存储下载的视频和缩略图。
- `./data`: 存储 SQLite 数据库和日志。

**重要提示：**  如果您移动  `docker-compose.yml`  文件，必须同时移动这些文件夹以保留您的数据。

对于仓库中 `stacks/` 下提供的单容器 stack，也可以通过 `MYTUBE_UPLOADS_DIR`
和 `MYTUBE_DATA_DIR` 覆盖宿主机路径，在不破坏现有默认路径兼容性的前提下，
把数据放到其他位置。

对于新部署，建议继续把 `uploads` 挂载到宿主机，但把 `/app/data` 改成 Docker named volume。SQLite 在这种模式下更稳妥，可以避开宿主机权限和 ACL 带来的兼容性问题。

后端卷配置示例：

```yaml
    volumes:
      - ./uploads:/app/uploads
      - mytube-data:/app/data
```

### 不重建镜像更新 yt-dlp

设置 -> yt-dlp 配置中会显示后端实际使用的 yt-dlp 版本；在 `container` 管理员信任级别下，
还会提供 **更新 yt-dlp** 按钮。

运行时更新不再对镜像内的 Python 环境或 `--user` 用户目录执行 `pip install -U`。
MyTube 会把每一次更新安装到 `/app/data/ytdlp/releases/` 下的新不可变目录，
校验成功后再原子替换 `/app/data/ytdlp/current.json`。已经开始的下载继续使用
原来的 release；新任务才会用上刚发布的版本。

该托管目录位于 `/app/data` 卷上，因此会在 `docker compose down && up`、容器重建
和镜像升级后继续存在。

每个 release 都是一个自包含的软件包目录，约占 50-100 MB。MyTube 会保留当前
release 以及之前的两个版本以便随时回退，并在确认没有下载仍在使用后自动删除更旧
的版本。长期运行的部署请为 `/app/data/ytdlp` 预留数百 MB 空间。

对于托管 release，设置页显示的路径是 MyTube 实际调用的 Python 解释器
（`<python> -m yt_dlp`），而不是 `yt-dlp` 可执行文件——因为 release 是一个软件包
目录而非独立二进制。当设置了 `YT_DLP_PATH`，或尚未创建任何托管 release 时，
设置页显示的仍是对应的可执行文件路径。

**回退到旧镜像并不能回退 yt-dlp。** `current.json` 仍指向最后一次发布的托管
release。若要恢复为镜像中固定的二进制：

1. 在删除托管目录**之前**固定镜像内路径：

```yaml
environment:
  - YT_DLP_PATH=/usr/local/bin/yt-dlp
```

绝对路径形式的 `YT_DLP_PATH` 会把该可执行文件标记为由部署者管理，同时禁用自动
升级和 **更新 yt-dlp** 按钮。`YT_DLP_PATH=yt-dlp` 不能实现硬固定。

2. 先停止服务，再删除托管目录（不会删除数据库或媒体）：

在**运行中**的后端里删除托管目录，会把正在进行的下载仍在使用的 yt-dlp 模块直接删掉；
而且在停机窗口内到达的请求可能会在新的 `YT_DLP_PATH` 生效前重新创建该目录。请先停止服务：

对于默认的双容器 stack（服务名为 `backend`）：

```bash
docker compose stop backend
docker compose run --rm --no-deps --entrypoint sh backend -c 'rm -rf /app/data/ytdlp'
```

对于仓库提供的单容器 stack（服务名为 `mytube`）：

```bash
docker compose -f stacks/docker-compose.single-container.yml stop mytube
docker compose -f stacks/docker-compose.single-container.yml run --rm --no-deps --entrypoint sh mytube -c 'rm -rf /app/data/ytdlp'
```

3. 重新创建服务，让 Compose 应用新的环境变量（仅执行 `restart` 不会应用
Compose 配置变更）：

```bash
# 默认双容器 stack
docker compose up -d --force-recreate backend

# 仓库提供的单容器 stack
docker compose -f stacks/docker-compose.single-container.yml up -d --force-recreate mytube
```

如果只想丢掉托管更新、让 MyTube 重新从 PATH/镜像发现（含过期自动安装），不要设置
`YT_DLP_PATH`，删除 `/app/data/ytdlp` 后重启即可。

旧版留下的 `/app/data/.home/.local` 在托管 release 发布后不会再被使用
（`PYTHONNOUSERSITE=1`）。如需回收磁盘可以删除：

```bash
docker compose stop backend
docker compose run --rm --no-deps --entrypoint sh backend -c 'rm -rf /app/data/.home/.local'
docker compose up -d backend
```

内置的 bgutil POT provider 不在此次更新范围内：它的 Python 插件会优先于任何 pip 副本从
镜像中加载，其 Node 服务端也随镜像一起发布，因此升级 provider 需要新的镜像。

### 环境变量

您可以通过添加  `.env`  文件或修改  `docker-compose.yml`  中的  `environment`  部分来自定义部署。

管理员信任模型可通过以下环境变量设置：

```env
MYTUBE_ADMIN_TRUST_LEVEL=container
```

可选值：

- `application`：管理员仅在应用层被视为受信任主体
- `container`：管理员被视为受信任的后端/容器进程级操作者
- `host`：管理员被视为受信任的宿主机范围操作者

完整能力差异说明请参考 [部署安全模型](deployment-security-model.md)。

| 变量                | 服务     | 描述                                | 默认值                |
| ------------------- | -------- | ----------------------------------- | --------------------- |
| `PORT`              | Backend  | 后端内部监听端口                    | `5551`                |
| `PUID`              | Backend  | 启动权限协调完成后，后端进程使用的 UID | `1000` |
| `PGID`              | Backend  | 启动权限协调完成后，后端进程使用的 GID | `1000` |
| `MYTUBE_AUTO_FIX_PERMISSIONS` | Backend | 是否在降权前自动对 bind mount 的 `data`/`uploads` 执行 chown | `1` |
| `MYTUBE_ADMIN_TRUST_LEVEL` | Backend  | 部署声明的管理员信任边界（`application`、`container`、`host`） | `container` |
| `VITE_API_URL`      | Frontend | API 端点路径                        | `/api`                |
| `API_HOST`          | Frontend | **高级：**  强制指定后端 IP         | _(自动检测)_          |
| `API_PORT`          | Frontend | **高级：**  强制指定后端端口        | `5551`                |
| `NGINX_BACKEND_URL` | Frontend | **高级：**  覆盖 Nginx 后端上游 URL | `http://backend:5551` |

后端容器现在会先以 root 启动，仅用于协调 bind mount 权限；随后会通过 `gosu` 以 `PUID:PGID` 启动 MyTube 主进程。

## 🛠️ 高级网络 (远程/NAS 部署)

如果您在远程服务器（例如 VPS 或 NAS）上部署，并从另一台计算机访问它，默认的相对 API 路径通常可以正常工作。

但是，如果您遇到连接问题（前端无法连接到后端），您可能需要明确告诉前端 API 的位置。

1. 在与  `docker-compose.yml`  相同的目录中创建一个  `.env`  文件：

   ```
   API_HOST=192.168.1.100  # 替换为您的服务器局域网/公网 IP
   API_PORT=5551
   ```

2. 重启容器：

   ```
   docker-compose down
   docker-compose up -d
   ```

## 🔌 部署在反向代理之后 (WebSocket 支持)

**实时翻译 (Live Translation)** 功能使用 **WebSocket** 连接 (`/api/live-translation/ws`)。MyTube 自带的 `frontend` 容器已经配置好将 WebSocket 升级转发到后端,因此**直接部署开箱即用**,无需任何额外配置。

但如果你在 MyTube 前面再套了**自己的**反向代理(Nginx Proxy Manager、Traefik、Caddy、手写的 Nginx vhost、群晖/QNAP 反向代理、Cloudflare Tunnel 等)来做 TLS 或自定义域名,那么这层代理**必须转发 WebSocket 升级**。这是所有使用 WebSocket 的应用的通用要求。如果没有开启,浏览器会报:

> WebSocket connection to 'wss://your-domain/api/live-translation/ws' failed: There was a bad response from the server.

在你的代理上开启 WebSocket 透传:

- **Nginx(手写 vhost):** 在代理 MyTube 的 location 中加上升级头。

    ```nginx
    location / {
        proxy_pass http://MYTUBE_FRONTEND_HOST:5556;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
    ```

- **Nginx Proxy Manager:** 编辑该 Proxy Host → **Details** 标签 → 打开 **Websockets Support** 开关 → 保存。
- **群晖 / QNAP 反向代理:** 在规则的 **自定义标头 (Custom Header)** 中添加 **WebSocket** 预设(会写入 `Upgrade` / `Connection`)。
- **Traefik / Caddy:** 无需额外配置,二者会自动转发 WebSocket 升级。
- **Cloudflare(代理 DNS / Tunnel):** 默认即支持 WebSocket,无需更改。

> [!TIP]
> 可以用 `curl` 端到端验证。配置正确的端点会抵达后端的升级处理器,返回一个**裸 `401`** 并带有 `X-Live-Translation-Error: ticket_missing` 头(裸 curl 没带票据,所以 ticket_missing 是预期的)。如果返回的是 **JSON 格式的 `401`**、HTML 页面或 `404`,说明前面某层代理把升级请求剥掉了。
>
> ```bash
> curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" \
>   -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
>   -H "Origin: https://your-domain" \
>   https://your-domain/api/live-translation/ws
> ```

## 🌐 使用出站 HTTP 代理 (`HTTP_PROXY` / `NO_PROXY`)

本节讲的是 MyTube 通过代理访问**外网**（mihomo、Clash、公司代理），与上一节的反向代理无关。

MyTube 启动 yt-dlp 时会把 backend 容器自身的环境变量传给它，因此在 `backend` 服务上设置的 `HTTP_PROXY` / `HTTPS_PROXY` 会作用于 yt-dlp 发出的**每一个**请求——包括视频流中的每一个 HLS 分片。MyTube 的界面上看不到这一点，所以由代理引起的变慢很容易被误判。

```yaml
services:
  backend:
    environment:
      - HTTP_PROXY=http://mihomo:7893
      - HTTPS_PROXY=http://mihomo:7893
      # 容器之间和本机回环的流量不要走代理。
      - NO_PROXY=localhost,127.0.0.1,backend,frontend,mihomo
```

### 正确书写 `NO_PROXY`

它的语法比看上去严格，写错了不会报错，只会静默失效：

| 应该这样写 | 不要这样写 | 原因 |
| --- | --- | --- |
| `surrit.com` | `*.surrit.com` | 条目按域名后缀匹配，`surrit.com` 本身已经涵盖 `cdn.surrit.com`。yt-dlp 的两套 HTTP 后端都不把开头的 `*.` 当通配符——这样的条目永远匹配不到。**单独一个** `*` 才是真正的通配符，含义是完全禁用代理。 |
| `mihomo,backend` | `172.28.0.0/16` | CIDR 网段只在浏览器指纹伪装（libcurl）这条路径上生效，在 yt-dlp 默认的 Python 路径上无效。请改为直接列出容器名或具体地址。 |

### 症状：只有 MissAV 下载极慢，其他一切正常

MissAV 的流受 Cloudflare 保护，MyTube 需要用 yt-dlp 的浏览器指纹伪装来抓取，而这会强制使用 yt-dlp 的**原生** HLS 下载器。该下载器通过普通 HTTP 请求逐个拉取分片，因此在代理之后，几百个分片中的每一个都要付出一次代理往返的代价。

MyTube 现在默认并行抓取 4 个分片，可以掩盖其中大部分延迟。如果你的线路还有余量，可以在**设置 → yt-dlp 配置**中调高：

```
--concurrent-fragments 8
```

如果想让该 CDN 完全不走代理，则把它的域名填进**设置 → yt-dlp 配置 → 绕过代理的主机**（`surrit.com`）。仅在容器确实可以直连外网时才这么做——如果你的部署本就要求全部流量走代理，绕过之后只会把"慢"变成"失败"。

### 两个会互相覆盖的设置

- **yt-dlp 配置里的 `--proxy` 会完全取代环境变量代理。** 一旦设置了它，yt-dlp 就会连同 `NO_PROXY` 和"绕过代理的主机"一起忽略——所有请求都走这一个代理。
- **"代理仅应用于 Youtube"现在也能压制环境变量代理。** 此前它只是去掉 `--proxy` 参数，因此容器级的 `HTTP_PROXY` 依然会代理非 YouTube 的下载。现在它会向 yt-dlp 明确下达直连指令。如果你原先是靠旧行为来给非 YouTube 站点走代理的，请关闭这个开关。

## 🏗️ 从源码构建 (可选)

如果您更喜欢自己构建镜像（例如，为了修改代码），请按照以下步骤操作：

1. **克隆仓库：**

   ```
   git clone https://github.com/franklioxygen/MyTube.git
   cd MyTube
   ```

2. **构建并运行：**  您可以使用相同的  `docker-compose.yml`  结构，但将  `image: ...`  替换为  `build: ...`。

   修改  `docker-compose.yml`：

   ```yaml
   services:
     backend:
       build: ./backend
       # ... 其他设置
     frontend:
       build: ./frontend
       # ... 其他设置
   ```

3. **启动：**

   ```
   docker-compose up -d --build
   ```

## ❓ 故障排除 (Troubleshooting)

### 1. "Network Error" 或 API 连接失败

- **原因:**  浏览器无法访问后端 API。
- **解决方法:**  确保端口  `5551`  在您的防火墙上已打开。如果在远程服务器上运行，请尝试按照“高级网络”部分的说明在  `.env`  文件中设置  `API_HOST`。

### 2. `./uploads` 或 `./data/mytube.db` 权限被拒绝 (Permission Denied)

- **原因:** 后端进程使用的 uid/gid 与宿主机 bind mount 文件 owner 不一致，或者宿主机文件系统不允许容器内执行 `chown`。
- **解决方法:**  先确认 `PUID` / `PGID` 是否与宿主机文件 owner 一致。默认值为 `1000:1000`，并且 MyTube 会在启动时自动尝试修复权限。

- **解决方法:** 如果自动修复失败，请在宿主机上调整 owner：
  ```
  chown -R 1000:1000 ./uploads ./data
  ```

- **解决方法:** 如果这些文件本来就归其他 uid/gid 所有，请在 `.env` 或 `docker-compose.yml` 中设置匹配值：
  ```
  PUID=1001
  PGID=1001
  ```

### 3. 容器名称冲突 (Container Name Conflicts)

- **原因:**  您有另一个 MyTube 实例正在运行，或者旧容器未被删除。
- **解决方法:**  在启动前删除旧容器：
  ```
  docker rm -f mytube-backend mytube-frontend
  docker-compose up -d
  ```

### 4. 连接被拒绝 / 无法连接互联网 (OpenWrt/iStoreOS)

- **原因:** 某些路由器系统上的 Docker bridge 网络兼容性问题。
- **解决方法:** 我们已在默认网络配置中添加了 `driver_opts` 以解决此问题。如果问题仍然存在：
  1.  编辑 `docker-compose.yml`。
  2.  为 `backend` 和 `frontend` 取消注释 `network_mode: host`。
  3.  删除（或注释掉）两个服务的 `ports` 和 `networks` 部分。
  4.  在 `frontend` 环境变量中设置 `NGINX_BACKEND_URL=http://localhost:5551`。
  5.  重启容器：`docker-compose up -d`

或者直接使用仓库提供的 `stacks/docker-compose.host-network.yml`：

```
docker-compose -f stacks/docker-compose.host-network.yml up -d
```

如果使用前后端合一的单容器部署，仓库还提供：

```
docker-compose -f stacks/docker-compose.single-container.yml up -d
```

### 5. 实时翻译报 "bad response from the server" (WebSocket)

- **原因:** MyTube 前面的某层反向代理没有转发 `/api/live-translation/ws` 的 WebSocket 升级。这只影响自己额外加了代理(TLS、自定义域名)的部署;自带的 `frontend` 容器已经处理好了。
- **修复:** 在你的代理上开启 WebSocket 支持 —— 参见 [部署在反向代理之后 (WebSocket 支持)](#-部署在反向代理之后-websocket-支持)。
