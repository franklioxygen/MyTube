# 开始使用

## 前提条件

- **Node.js** (推荐 v18 或更高版本)
- **npm** (v9 或更高版本) 或 **yarn**
- **Python 3.8+** (用于 yt-dlp 和 PO Token 提供者)
- **yt-dlp** (通过 pip/pipx 安装)
- **Docker** (可选，用于容器化部署)

## 安装

### 1. 克隆仓库

```bash
git clone https://github.com/franklioxygen/mytube.git
cd mytube
```

### 2. 安装依赖

您可以使用一条命令安装根目录、前端和后端的所有依赖：

```bash
npm run install:all
```

或者手动安装：

```bash
npm install
cd frontend && npm install
cd ../backend && npm install
```

**注意**: 后端安装会自动构建 `bgutil-ytdlp-pot-provider` 服务器。但是，您必须确保在环境中安装了 `yt-dlp` 和 `bgutil-ytdlp-pot-provider` Python 插件：

```bash
# 安装 yt-dlp 和插件
pip install yt-dlp bgutil-ytdlp-pot-provider

# 或使用 pipx (推荐，用于隔离)
pipx install yt-dlp
pipx inject yt-dlp bgutil-ytdlp-pot-provider
```

### 3. 配置环境变量

#### 后端配置

在 `backend/` 目录中创建 `.env` 文件：

```env
PORT=5551
UPLOAD_DIR=uploads
VIDEO_DIR=uploads/videos
IMAGE_DIR=uploads/images
SUBTITLES_DIR=uploads/subtitles
DATA_DIR=data
MAX_FILE_SIZE=500000000
```

#### 前端配置

在 `frontend/` 目录中创建 `.env` 文件：

```env
VITE_API_URL=http://localhost:5551/api
VITE_BACKEND_URL=http://localhost:5551
```

### 4. 数据库设置

应用程序使用 **SQLite** 和 **Drizzle ORM**。数据库将在首次启动时自动创建和迁移：

- 数据库位置: `backend/data/mytube.db`
- 迁移在服务器启动时自动运行
- 如果您有旧的 JSON 数据，可以使用设置页面或 API 端点进行迁移

## 运行应用

### 开发模式

从根目录启动前端和后端：

```bash
npm run dev
```

这将启动：

- **前端**: http://localhost:5556 (带热重载的 Vite 开发服务器)
- **后端 API**: http://localhost:5551 (带 nodemon 的 Express 服务器)

### 生产模式

构建并以生产模式启动：

```bash
# 构建前端
npm run build

# 启动两个服务
npm run start
```

### 单独运行服务

您也可以单独运行服务：

```bash
# 仅后端
cd backend
npm run dev        # 开发模式
npm run start      # 生产模式

# 仅前端
cd frontend
npm run dev        # 开发模式
npm run preview    # 预览生产构建
```

## 可用脚本

从根目录：

```bash
npm run dev          # 以开发模式启动前端和后端
npm run start        # 以生产模式启动前端和后端
npm run build        # 为生产环境构建前端
npm run install:all  # 安装根目录、前端和后端的依赖
```

后端特定脚本 (从 `backend/` 目录)：

```bash
npm run dev          # 使用 nodemon 启动后端 (自动重载)
npm run start        # 以生产模式启动后端
npm run build        # 将 TypeScript 编译为 JavaScript
npm run test         # 使用 Vitest 运行测试
npm run test:coverage # 运行测试并生成覆盖率报告
npm run generate     # 使用 Drizzle Kit 生成数据库迁移
```

前端特定脚本 (从 `frontend/` 目录)：

```bash
npm run dev          # 启动 Vite 开发服务器
npm run build        # 为生产环境构建
npm run preview      # 预览生产构建
npm run lint         # 运行 ESLint
npm run test         # 使用 Vitest 运行测试
```

## 首次设置

1. **访问应用**: 在浏览器中打开 http://localhost:5556

2. **设置密码保护** (可选):

   - 转到设置 → 安全
   - 启用密码保护并设置密码

3. **配置下载设置**:

   - 转到设置 → 下载设置
   - 设置并发下载限制
   - 配置下载质量偏好

4. **上传 Cookies** (可选，用于年龄限制/会员内容):

   - 转到设置 → Cookie 设置
   - 上传您的 `cookies.txt` 文件

5. **开始下载**:
   - 在下载输入框中输入视频 URL
   - 支持的平台: YouTube, Bilibili, MissAV 以及所有 yt-dlp 支持的网站

## 架构概述

### 后端

- **框架**: Express.js with TypeScript
- **数据库**: SQLite with Drizzle ORM
- **架构**: 分层 (路由 → 控制器 → 服务 → 数据库)
- **下载器**: 用于平台特定实现的抽象基类模式

### 前端

- **框架**: React 19 with TypeScript
- **构建工具**: Vite
- **UI 库**: Material-UI (MUI)
- **状态管理**: React Context API
- **路由**: React Router v7

### 关键特性

- **模块化存储服务**: 拆分为专注的模块以提高可维护性
- **下载队列管理**: 支持队列的并发下载
- **视频下载跟踪**: 防止重复下载
- **订阅系统**: 从订阅的频道自动下载
- **数据库迁移**: 启动时自动更新模式

## 故障排除

### 数据库问题

- 如果遇到数据库错误，请检查 `backend/data/` 目录是否存在且可写
- 要重置数据库，请删除 `backend/data/mytube.db` 并重启服务器

### 下载问题

- 确保 `yt-dlp` 已安装且可在您的 PATH 中访问
- 检查是否安装了 `bgutil-ytdlp-pot-provider` 插件
- 验证网络连接和防火墙设置

### 端口冲突

- 如果端口 5551 或 5556 被占用，请修改 PORT 环境变量
- 相应地更新前端 `VITE_API_URL` 和 `VITE_BACKEND_URL`

### 文件监视器限制（ENOSPC 错误）

如果在运行前端开发服务器时遇到 `ENOSPC: System limit for number of file watchers reached` 错误：

**注意：** 项目的 `vite.config.js` 已配置为使用基于轮询的文件监视作为解决方案，这应该能在大多数情况下防止此错误。如果您仍然遇到此问题，请尝试以下解决方案：

**在 Linux（主机系统）上：**

```bash
# 检查当前限制
cat /proc/sys/fs/inotify/max_user_watches

# 增加限制（临时，重启后失效）
sudo sysctl fs.inotify.max_user_watches=524288

# 永久设置
echo "fs.inotify.max_user_watches=524288" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

**在 Docker 中：**
在 `docker-compose.yml` 的前端服务下添加：

```yaml
services:
  frontend:
    sysctls:
      - fs.inotify.max_user_watches=524288
```

或使用以下命令运行容器：

```bash
docker run --sysctl fs.inotify.max_user_watches=524288 ...
```

**替代方案：配置 Vite 使用轮询（本项目已配置）：**

`vite.config.js` 文件包含一个使用轮询而非原生文件监视器的监视配置，这完全绕过了 inotify 限制：

```js
server: {
  watch: {
    usePolling: true,
    interval: 2000,
    ignored: ['/node_modules/']
  }
}
```

这已在项目中配置，因此不应出现此错误。如果您使用自定义 Vite 配置，请确保包含此配置。

## 下一步

- 阅读 [API 端点](api-endpoints.md) 文档
- 查看 [目录结构](directory-structure.md) 了解代码组织
- 查看 [Docker 部署指南](docker-guide.md) 了解生产部署
