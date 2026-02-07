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
```

默认数据与上传路径位于 `backend/data` 和 `backend/uploads`（相对于后端工作目录）。

#### 前端配置

在 `frontend/` 目录中创建 `.env` 文件：

```env
VITE_API_URL=/api
VITE_BACKEND_URL=
```

项目提供 `backend/.env.example`，请复制为 `backend/.env` 并按需调整。前端已提供 `frontend/.env`，如需覆盖默认值请使用 `frontend/.env.local`。

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

### 生产模式 (本地)

构建并以生产模式启动：

```bash
# 构建前端
npm run build

# 启动后端
cd backend
npm run start

# 在另一个终端预览前端构建
cd frontend
npm run preview
```

生产环境建议参考 [Docker 部署指南](docker-guide.md)。

根目录的 `npm run start` 为便捷命令，会同时运行后端启动脚本和前端开发服务器。

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
npm run start        # 启动后端 + 前端开发服务器 (便捷)
npm run build        # 为生产环境构建前端
npm run install:all  # 安装根目录、前端和后端的依赖
npm run test         # 运行前后端测试
npm run test:frontend # 运行前端测试
npm run test:backend  # 运行后端测试
```

后端特定脚本 (从 `backend/` 目录)：

```bash
npm run dev          # 使用 nodemon 启动后端 (自动重载)
npm run start        # 以生产模式启动后端
npm run build        # 将 TypeScript 编译为 JavaScript
npm run test         # 使用 Vitest 运行测试
npm run test:coverage # 运行测试并生成覆盖率报告
npm run generate     # 使用 Drizzle Kit 生成数据库迁移
npm run reset-password # 使用脚本重置管理员密码
```

前端特定脚本 (从 `frontend/` 目录)：

```bash
npm run dev          # 启动 Vite 开发服务器
npm run build        # 为生产环境构建
npm run preview      # 预览生产构建
npm run lint         # 运行 ESLint
npm run test         # 使用 Vitest 运行测试
npm run test:coverage # 运行测试并生成覆盖率报告
```

## 首次设置

1. **访问应用**: 在浏览器中打开 http://localhost:5556

2. **设置登录保护** (可选):

   - 转到设置 → 安全
   - 启用登录并设置管理员密码
   - 可选：注册通行密钥 (WebAuthn)

3. **配置下载设置**:

   - 转到设置 → 下载设置
   - 设置并发下载限制
   - 配置下载质量偏好

4. **上传 Cookies** (可选，用于年龄限制/会员内容):

   - 转到设置 → Cookie 设置
   - 上传您的 `cookies.txt` 文件

5. **配置云存储** (可选):

   - 转到设置 → 云盘设置
   - 启用"启用自动保存到云盘"
   - 输入您的 OpenList/Alist API URL (例如: `https://your-alist-instance.com/api/fs/put`)
   - 输入您的 API 令牌
   - 可选：设置用于直接文件访问的公共 URL
   - 设置上传路径 (例如: `/mytube-uploads`)
   - 测试连接以验证设置
   - 注意：启用后，视频将在下载后自动上传到云存储，本地文件将被删除

6. **配置访客用户** (可选):

   - 转到设置 → 安全
   - 启用“访客用户”以获得只读访问
   - 为访客角色设置登录密码

7. **开始下载**:
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

## 从源码（标签）部署后的升级

如果您是通过从 [发布标签](https://github.com/franklioxygen/MyTube/tags) 下载并解压源码来部署 MyTube（例如 **v1.7.112**），请按以下步骤升级。

### 1. 检查是否有新版本

- 在应用内：页脚或设置中可能会显示更新提示及最新版本的链接。
- 或调用 API：`GET /api/system/version` 会返回 `currentVersion`、`latestVersion`、`releaseUrl` 和 `hasUpdate`。

### 2. 下载新版本

- 打开 [标签页](https://github.com/franklioxygen/MyTube/tags)，选择要升级到的标签（如最新标签）。
- 下载该标签的源码压缩包（**Source code (zip)** 或 **Source code (tar.gz)**）。
- 将压缩包解压到**新**目录（如 `mytube-new`），先不要覆盖当前正在运行的安装目录。

### 3. 保留数据与配置

在替换应用前，请确保保留：

- **数据库与应用数据**：`backend/data/`（包含 `mytube.db` 等）。
- **上传/视频文件**：`backend/uploads/`（或您配置的上传路径）。
- **环境配置**：`backend/.env` 以及 `frontend/.env`（或 `.env.local`）中的配置。

请备份上述内容或记下路径，以便升级后恢复。

### 4. 用新源码替换应用

- 停止正在运行的 MyTube 进程。
- 用新解压的源码**替换**部署目录中的应用程序文件（或将部署目录指向新解压的目录）。
- 将保留的**数据与配置**复制回去：
  - 恢复或保留 `backend/data/` 和 `backend/uploads/`。
  - 恢复 `backend/.env` 及前端环境配置文件。

**不要**用新压缩包里的空目录覆盖现有的 `backend/data/` 或 `backend/uploads/`。

### 5. 重新安装依赖、构建并启动

在升级后的**项目根目录**执行：

```bash
npm run install:all
npm run build
```

然后按您平时的方式启动应用（例如在根目录执行 `npm run start`，或分别启动后端并托管前端）。若新版本包含数据库变更，启动时会自动执行迁移。

**简要说明**：下载新标签源码 → 保留 `backend/data`、`backend/uploads` 和 `.env` 文件 → 用新代码替换其余部分 → `npm run install:all` → `npm run build` → 启动应用。

## 下一步

- 阅读 [API 端点](api-endpoints.md) 文档
- 查看 [目录结构](directory-structure.md) 了解代码组织
- 查看 [Docker 部署指南](docker-guide.md) 了解生产部署
