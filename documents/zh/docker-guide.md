# MyTube Docker 部署指南

本指南提供了使用 Docker 和 Docker Compose 部署 [MyTube](https://github.com/franklioxygen/MyTube "null") 的详细步骤。此设置适用于标准环境（Linux, macOS, Windows），并针对通用用途修改了原本专用于 QNAP 的配置。

## 🚀 快速开始 (使用预构建镜像)

运行 MyTube 最简单的方法是使用官方预构建的镜像。

### 1. 创建项目目录

为您的项目创建一个文件夹并进入该目录：

```
mkdir mytube-deploy
cd mytube-deploy
```

### 2. 创建 `docker-compose.yml` 文件

在文件夹中创建一个名为 `docker-compose.yml` 的文件，并粘贴以下内容。

**注意：** 此版本使用标准的相对路径（`./data`, `./uploads`），而不是原始仓库中特定于 QNAP 的路径。

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
      # 可选：如果需要，在容器内设置自定义上传目录
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
      # 内部 Docker 网络 URL（浏览器 -> 前端 -> 后端）
      # 在大多数设置中，这些默认值都可以正常工作。
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

### 3. 启动应用

运行以下命令在后台启动服务：

```
docker-compose up -d
```

### 4. 访问 MyTube

容器运行后，请在浏览器中访问应用程序：

- **前端 UI:** `http://localhost:5556`
    
- **后端 API:** `http://localhost:5551`
    

## ⚙️ 配置与数据持久化

### 卷 (数据存储)

上面的 `docker-compose.yml` 在当前目录中创建了两个文件夹来持久保存数据：

- `./uploads`: 存储下载的视频和缩略图。
    
- `./data`: 存储 SQLite 数据库和日志。
    

**重要提示：** 如果您移动 `docker-compose.yml` 文件，必须同时移动这些文件夹以保留您的数据。

### 环境变量

您可以通过添加 `.env` 文件或修改 `docker-compose.yml` 中的 `environment` 部分来自定义部署。

|变量|服务|描述|默认值|
|---|---|---|---|
|`PORT`|Backend|后端内部监听端口|`5551`|
|`VITE_API_URL`|Frontend|API 端点路径|`/api`|
|`API_HOST`|Frontend|**高级：** 强制指定后端 IP|_(自动检测)_|
|`API_PORT`|Frontend|**高级：** 强制指定后端端口|`5551`|

## 🛠️ 高级网络 (远程/NAS 部署)

如果您在远程服务器（例如 VPS 或 NAS）上部署，并从另一台计算机访问它，默认的相对 API 路径通常可以正常工作。

但是，如果您遇到连接问题（前端无法连接到后端），您可能需要明确告诉前端 API 的位置。

1. 在与 `docker-compose.yml` 相同的目录中创建一个 `.env` 文件：
    
    ```
    API_HOST=192.168.1.100  # 替换为您的服务器局域网/公网 IP
    API_PORT=5551
    ```
    
2. 重启容器：
    
    ```
    docker-compose down
    docker-compose up -d
    ```
    

## 🏗️ 从源码构建 (可选)

如果您更喜欢自己构建镜像（例如，为了修改代码），请按照以下步骤操作：

1. **克隆仓库：**
    
    ```
    git clone [https://github.com/franklioxygen/MyTube.git](https://github.com/franklioxygen/MyTube.git)
    cd MyTube
    ```
    
2. **构建并运行：** 您可以使用相同的 `docker-compose.yml` 结构，但将 `image: ...` 替换为 `build: ...`。
    
    修改 `docker-compose.yml`：
    
    ```
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

- **原因:** 浏览器无法访问后端 API。
    
- **解决方法:** 确保端口 `5551` 在您的防火墙上已打开。如果在远程服务器上运行，请尝试按照“高级网络”部分的说明在 `.env` 文件中设置 `API_HOST`。
    

### 2. `./uploads` 权限被拒绝 (Permission Denied)

- **原因:** Docker 容器用户没有主机目录的写入权限。
    
- **解决方法:** 调整主机上的权限：
    
    ```
    chmod -R 777 ./uploads ./data
    ```
    

### 3. 容器名称冲突 (Container Name Conflicts)

- **原因:** 您有另一个 MyTube 实例正在运行，或者旧容器未被删除。
    
- **解决方法:** 在启动前删除旧容器：
    
    ```
    docker rm -f mytube-backend mytube-frontend
    docker-compose up -d
    ```