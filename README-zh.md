# MyTube

一个 YouTube/Bilibili 视频下载和播放应用，允许您将 YouTube/Bilibili 视频及其缩略图本地保存。将您的视频整理到收藏夹中，以便轻松访问和管理。

[English](README.md)

![Nov-22-2025 13-56-10](https://github.com/user-attachments/assets/ee8e9f84-1597-4d4e-a238-8ea7d9e0f590)

## 功能特点

- **视频下载**：通过简单的 URL 输入下载 YouTube 和 Bilibili 视频。
- **视频上传**：直接上传本地视频文件到您的库，并自动生成缩略图。
- **Bilibili 支持**：支持下载单个视频、多P视频以及整个合集/系列。
- **并行下载**：支持队列下载，可同时追踪多个下载任务的进度。
- **本地库**：自动保存视频缩略图和元数据，提供丰富的浏览体验。
- **视频播放器**：自定义播放器，支持播放/暂停、循环和快进/快退控制。
- **搜索功能**：支持在本地库中搜索视频，或在线搜索 YouTube 视频。
- **收藏夹**：创建自定义收藏夹以整理您的视频。
- **现代化 UI**：响应式深色主题界面，包含“返回主页”功能和玻璃拟态效果。
- **主题支持**：支持在明亮和深色模式之间切换。

## 目录结构

```
mytube/
├── backend/             # Express.js 后端 (TypeScript)
│   ├── src/             # 源代码
│   │   ├── config/      # 配置文件
│   │   ├── controllers/ # 路由控制器
│   │   ├── routes/      # API 路由
│   │   ├── services/    # 业务逻辑服务
│   │   ├── utils/       # 工具函数
│   │   └── server.ts    # 主服务器文件
│   ├── uploads/         # 上传文件目录
│   │   ├── videos/      # 下载的视频
│   │   └── images/      # 下载的缩略图
│   └── package.json     # 后端依赖
├── frontend/            # React.js 前端 (Vite + TypeScript)
│   ├── src/             # 源代码
│   │   ├── assets/      # 图片和样式
│   │   ├── components/  # React 组件
│   │   ├── pages/       # 页面组件
│   │   └── theme.ts     # 主题配置
│   └── package.json     # 前端依赖
├── build-and-push.sh    # Docker 构建脚本
├── docker-compose.yml   # Docker Compose 配置
├── DEPLOYMENT.md        # 部署指南
└── package.json         # 运行两个应用的根 package.json
```

## 开始使用

### 前提条件

- Node.js (v14 或更高版本)
- npm (v6 或更高版本)
- Docker (可选，用于容器化部署)

### 安装

1. 克隆仓库：

   ```bash
   git clone <repository-url>
   cd mytube
   ```

2. 安装依赖：

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

#### 使用 npm 脚本

您可以在根目录下使用 npm 脚本：

```bash
npm run dev       # 以开发模式启动前端和后端
```

其他可用脚本：

```bash
npm run start     # 以生产模式启动前端和后端
npm run build     # 为生产环境构建前端
```

### 访问应用

- 前端：http://localhost:5556
- 后端 API：http://localhost:5551

## API 端点

### 视频
- `POST /api/download` - 下载视频 (YouTube 或 Bilibili)
- `POST /api/upload` - 上传本地视频文件
- `GET /api/videos` - 获取所有已下载的视频
- `GET /api/videos/:id` - 获取特定视频
- `DELETE /api/videos/:id` - 删除视频
- `GET /api/search` - 在线搜索视频
- `GET /api/download-status` - 获取当前下载状态
- `GET /api/check-bilibili-parts` - 检查 Bilibili 视频是否包含多个分P
- `GET /api/check-bilibili-collection` - 检查 Bilibili URL 是否为合集/系列

### 收藏夹
- `GET /api/collections` - 获取所有收藏夹
- `POST /api/collections` - 创建新收藏夹
- `PUT /api/collections/:id` - 更新收藏夹 (添加/移除视频)
- `DELETE /api/collections/:id` - 删除收藏夹

## 收藏夹功能

MyTube 允许您将视频整理到收藏夹中：

- **创建收藏夹**：创建自定义收藏夹以对视频进行分类。
- **添加到收藏夹**：直接从视频播放器或管理页面将视频添加到一个或多个收藏夹。
- **从收藏夹中移除**：轻松从收藏夹中移除视频。
- **浏览收藏夹**：在侧边栏查看所有收藏夹，并按收藏夹浏览视频。

## 用户界面

该应用具有现代化、高级感的 UI，包括：

- **深色/明亮模式**：根据您的喜好切换主题。
- **响应式设计**：在桌面和移动设备上无缝运行。
- **视频网格**：便于浏览的视频库网格布局。
- **确认模态框**：带有自定义确认对话框的安全删除功能。
- **搜索**：集成的搜索栏，用于查找本地和在线内容。

## 环境变量

该应用使用环境变量进行配置。

### 前端 (`frontend/.env`)

```env
VITE_API_URL=http://localhost:5551/api
VITE_BACKEND_URL=http://localhost:5551
```

### 后端 (`backend/.env`)

```env
PORT=5551
UPLOAD_DIR=uploads
VIDEO_DIR=uploads/videos
IMAGE_DIR=uploads/images
MAX_FILE_SIZE=500000000
```

复制前端和后端目录中的 `.env.example` 文件以创建您自己的 `.env` 文件。

## 部署

有关如何使用 Docker 或在 QNAP Container Station 上部署 MyTube 的详细说明，请参阅 [DEPLOYMENT.md](DEPLOYMENT.md)。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&legend=bottom-right)](https://www.star-history.com/#franklioxygen/MyTube&type=date&legend=bottom-right)

## 许可证

MIT
