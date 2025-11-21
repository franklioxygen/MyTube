# MyTube

一个 YouTube/Bilibili 视频下载和播放应用，允许您将 YouTube/Bilibili 视频及其缩略图本地保存。将您的视频整理到收藏夹中，以便轻松访问和管理。

[English](README.md)

![Nov-21-2025 16-53-03](https://github.com/user-attachments/assets/1f23ba18-da7a-4011-b716-6daa628552a5)


## 功能特点

- 通过简单的 URL 输入下载 YouTube 和 Bilibili 视频
- 自动保存视频缩略图
- 浏览和播放已下载的视频
- 查看特定作者的视频
- 将视频整理到收藏夹中
- 将视频添加到多个收藏夹
- 适用于所有设备的响应式设计

## 目录结构

```
mytube/
├── backend/             # Express.js 后端
│   ├── src/             # 源代码
│   │   ├── config/      # 配置文件
│   │   ├── controllers/ # 路由控制器
│   │   ├── routes/      # API 路由
│   │   ├── services/    # 业务逻辑服务
│   │   └── utils/       # 工具函数
│   ├── uploads/         # 上传文件目录
│   │   ├── videos/      # 下载的视频
│   │   └── images/      # 下载的缩略图
│   └── server.js        # 主服务器文件
├── frontend/            # React.js 前端
│   ├── public/          # 静态资源
│   ├── src/             # 源代码
│   │   ├── assets/      # 图片和样式
│   │   ├── components/  # React 组件
│   │   └── pages/       # 页面组件
│   └── index.html       # HTML 入口点
├── start.sh             # Unix/Mac 启动脚本
├── start.bat            # Windows 启动脚本
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

   ```
   git clone <repository-url>
   cd mytube
   ```

2. 安装依赖：

   您可以使用一条命令安装根目录、前端和后端的所有依赖：

   ```
   npm run install:all
   ```

   或者手动安装：

   ```
   npm install
   cd frontend && npm install
   cd ../backend && npm install
   ```

#### 使用 npm 脚本

或者，您可以使用 npm 脚本：

```
npm run dev       # 以开发模式启动前端和后端
```

其他可用脚本：

```
npm run start     # 以生产模式启动前端和后端
npm run build     # 为生产环境构建前端
```

### 访问应用

- 前端：http://localhost:5556
- 后端 API：http://localhost:5551

## API 端点

- `POST /api/download/youtube` - 下载 YouTube 视频
- `POST /api/download/bilibili` - 下载 Bilibili 视频
- `GET /api/videos` - 获取所有已下载的视频
- `GET /api/videos/:id` - 获取特定视频
- `DELETE /api/videos/:id` - 删除视频
- `GET /api/collections` - 获取所有收藏夹
- `POST /api/collections` - 创建新收藏夹
- `PUT /api/collections/:id` - 更新收藏夹
- `DELETE /api/collections/:id` - 删除收藏夹
- `POST /api/collections/:id/videos` - 将视频添加到收藏夹
- `DELETE /api/collections/:id/videos/:videoId` - 从收藏夹中移除视频

## 收藏夹功能

MyTube 允许您将视频整理到收藏夹中：

- **创建收藏夹**：创建自定义收藏夹以对视频进行分类
- **添加到收藏夹**：直接从视频播放器将视频添加到一个或多个收藏夹
- **从收藏夹中移除**：一键从收藏夹中移除视频
- **浏览收藏夹**：在侧边栏查看所有收藏夹，并按收藏夹浏览视频

## 用户界面

该应用具有现代化、深色主题的 UI，包括：

- 适用于桌面和移动设备的响应式设计
- 方便浏览的视频网格布局
- 带有收藏夹管理的视频播放器
- 按作者和收藏夹筛选
- 用于查找视频的搜索功能

## 环境变量

该应用使用环境变量进行配置。以下是设置方法：

### 前端（frontend 目录中的 .env 文件）

```
VITE_API_URL=http://localhost:5551/api
VITE_BACKEND_URL=http://localhost:5551
VITE_APP_PORT=5556
```

### 后端（backend 目录中的 .env 文件）

```
PORT=5551
UPLOAD_DIR=uploads
VIDEO_DIR=uploads/videos
IMAGE_DIR=uploads/images
MAX_FILE_SIZE=500000000
```

将前端和后端目录中的 `.env.example` 文件复制以创建自己的 `.env` 文件，并用所需的值替换占位符。

## 部署

有关如何使用 Docker 或在 QNAP Container Station 上部署 MyTube 的详细说明，请参阅 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 许可证

MIT
