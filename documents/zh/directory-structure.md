# 目录结构

```
mytube/
├── backend/                           # Express.js 后端 (TypeScript)
│   ├── src/                           # 源代码
│   │   ├── __tests__/                 # 测试文件
│   │   ├── config/                    # 配置（路径等）
│   │   ├── controllers/               # 路由控制器
│   │   │   ├── cleanupController.ts
│   │   │   ├── cloudStorageController.ts
│   │   │   ├── collectionController.ts
│   │   │   ├── cookieController.ts
│   │   │   ├── downloadController.ts
│   │   │   ├── hookController.ts
│   │   │   ├── passkeyController.ts
│   │   │   ├── passwordController.ts
│   │   │   ├── scanController.ts
│   │   │   ├── settingsController.ts
│   │   │   ├── subscriptionController.ts
│   │   │   ├── systemController.ts
│   │   │   ├── videoController.ts
│   │   │   ├── videoDownloadController.ts
│   │   │   └── videoMetadataController.ts
│   │   ├── db/                        # Drizzle ORM + SQLite
│   │   ├── errors/                    # 自定义错误类
│   │   ├── middleware/                # Express 中间件
│   │   │   ├── authMiddleware.ts
│   │   │   ├── roleBasedAuthMiddleware.ts
│   │   │   ├── roleBasedSettingsMiddleware.ts
│   │   │   └── errorHandler.ts
│   │   ├── routes/                    # 路由定义
│   │   │   ├── api.ts                 # 主 API 路由
│   │   │   └── settingsRoutes.ts      # 设置相关路由
│   │   ├── scripts/                   # 工具脚本 (VTT 清理、字幕重扫)
│   │   ├── services/                  # 业务逻辑
│   │   │   ├── cloudStorage/          # 云存储相关与缓存
│   │   │   ├── continuousDownload/    # 订阅任务引擎
│   │   │   ├── downloaders/           # 平台下载器 (yt-dlp、Bilibili、MissAV)
│   │   │   ├── storageService/        # 模块化存储服务
│   │   │   └── *.ts                   # 其他服务 (auth、metadata 等)
│   │   ├── utils/                     # 工具函数
│   │   ├── server.ts                  # 服务器入口
│   │   └── version.ts                 # 版本信息
│   ├── bgutil-ytdlp-pot-provider/     # PO Token 提供者插件
│   ├── data/                          # 运行数据 (数据库、hooks、备份)
│   ├── drizzle/                       # 数据库迁移
│   ├── uploads/                       # 媒体存储 (videos/images/subtitles/cache)
│   ├── scripts/                       # 维护脚本 (reset-password、migrate、verify)
│   ├── Dockerfile
│   ├── drizzle.config.ts
│   ├── nodemon.json
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── frontend/                          # React 前端 (Vite + TypeScript)
│   ├── src/                           # 源代码
│   │   ├── __tests__/                 # 测试文件
│   │   ├── assets/                    # 静态资源
│   │   ├── components/                # 按功能划分的 UI 组件
│   │   ├── contexts/                  # React Context 状态
│   │   ├── hooks/                     # 自定义 hooks (播放器、设置、数据)
│   │   ├── pages/                     # 路由页面
│   │   ├── utils/                     # API 客户端、工具、多语言
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── theme.ts
│   │   └── version.ts
│   ├── public/                        # 公共静态资源
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── nginx.conf
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.js
├── documents/                         # 文档 (EN/ZH)
├── docker-compose.yml                 # 标准部署 Compose
├── docker-compose.host-network.yml    # OpenWrt/iStoreOS 的 host 网络 Compose
├── README.md
├── README-zh.md
└── package.json                       # 根目录脚本
```

## 架构概述

### 后端架构

后端遵循 **分层架构**：

1. **Routes** (`routes/`): 定义 API 端点并映射到控制器
2. **Controllers** (`controllers/`): 处理 HTTP 请求/响应
3. **Services** (`services/`): 业务逻辑（下载器、存储、云存储、订阅等）
4. **Database** (`db/`): Drizzle ORM + SQLite
5. **Utils** (`utils/`): 通用工具与基础设施

### 前端架构

前端遵循 **组件化架构**：

1. **Pages** (`pages/`): 顶级路由组件
2. **Components** (`components/`): 以功能划分的 UI 组件
3. **Contexts** (`contexts/`): React Context 全局状态
4. **Hooks** (`hooks/`): 可复用逻辑和数据访问
5. **Utils** (`utils/`): API、格式化和多语言辅助

### 数据库模式

关键表包括：

- `videos`: 视频元数据和文件路径
- `collections`: 视频收藏夹/播放列表
- `collection_videos`: 视频与收藏夹的多对多关系
- `subscriptions`: 频道/创作者订阅
- `downloads`: 活动下载队列
- `download_history`: 完成的下载历史
- `video_downloads`: 跟踪已下载视频以防止重复
- `settings`: 应用配置
