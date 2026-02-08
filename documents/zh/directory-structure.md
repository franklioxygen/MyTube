# 目录结构

```
mytube/
├── backend/                           # Express.js 后端 (TypeScript)
│   ├── src/                           # 源代码
│   │   ├── __tests__/                 # 单元/集成测试
│   │   ├── config/                    # 路径和运行时配置
│   │   ├── controllers/               # HTTP 路由控制器
│   │   │   ├── cleanupController.ts
│   │   │   ├── cloudStorageController.ts
│   │   │   ├── collectionController.ts
│   │   │   ├── cookieController.ts
│   │   │   ├── databaseBackupController.ts
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
│   │   ├── db/                        # Drizzle ORM 架构 + 迁移运行器
│   │   ├── errors/                    # 自定义错误类型
│   │   ├── middleware/                # 认证/角色/错误中间件
│   │   ├── routes/                    # API 路由注册
│   │   ├── scripts/                   # 内部维护脚本
│   │   ├── services/                  # 业务逻辑
│   │   │   ├── cloudStorage/          # 云存储上传/签名/缓存工具
│   │   │   ├── continuousDownload/    # 持续任务处理
│   │   │   ├── downloaders/           # 提供商下载实现
│   │   │   │   ├── bilibili/
│   │   │   │   └── ytdlp/
│   │   │   ├── storageService/        # 文件/数据库存储模块
│   │   │   └── *.ts                   # 认证、订阅、元数据等其他服务
│   │   ├── types/                     # 共享 TS 类型声明
│   │   ├── utils/                     # 共享辅助函数
│   │   ├── server.ts                  # 应用启动入口
│   │   └── version.ts                 # 应用版本信息
│   ├── bgutil-ytdlp-pot-provider/     # yt-dlp PO Token 辅助项目
│   ├── data/                          # 后端运行时数据 (数据库、hooks、cookies)
│   ├── drizzle/                       # SQL 迁移文件
│   ├── uploads/                       # 后端媒体文件和缓存
│   ├── scripts/                       # CLI 维护脚本
│   ├── dist/                          # 后端编译输出
│   ├── coverage/                      # 测试覆盖率输出
│   ├── Dockerfile
│   ├── drizzle.config.ts
│   ├── nodemon.json
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── frontend/                          # React 前端 (Vite + TypeScript)
│   ├── src/                           # 源代码
│   │   ├── __tests__/                 # 应用级测试
│   │   ├── assets/                    # 静态资源 (Logo、声音等)
│   │   ├── components/                # UI 组件 (Header、Settings、VideoPlayer...)
│   │   ├── contexts/                  # 全局状态提供者
│   │   ├── hooks/                     # 数据获取和 UI 逻辑 Hook
│   │   ├── pages/                     # 路由级页面
│   │   ├── utils/                     # API 助手、多语言、格式化
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── theme.ts
│   │   └── version.ts
│   ├── public/                        # 公共静态文件
│   ├── scripts/                       # 前端工具脚本 (例如 waitForBackend)
│   ├── dist/                          # 前端构建输出
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── nginx.conf
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.js
├── chrome-extension/                  # 浏览器扩展源码
├── documents/                         # 文档 (EN/ZH)
│   ├── en/
│   └── zh/
├── codeql-db/                         # CodeQL 数据库 (分析产物)
├── codeql-reports/                    # CodeQL 报告输出
├── data/                              # 可选运行时数据 (如果从仓库根目录启动)
├── uploads/                           # 可选运行时媒体 (如果从仓库根目录启动)
├── stacks/                            # 部署栈示例
├── docker-compose.yml
├── docker-compose.host-network.yml
├── README.md
├── README-zh.md
└── package.json                       # 根目录任务运行脚本
```

## 架构概述

### 后端架构

后端采用分层设计：

1. **Routes** (`backend/src/routes/`): 定义端点并映射到控制器。
2. **Controllers** (`backend/src/controllers/`): 验证请求输入并构造 HTTP 响应。
3. **Services** (`backend/src/services/`): 核心业务逻辑，用于下载、订阅、云同步、存储、认证和元数据处理。
4. **Storage Layer**:
   - **Database** (`backend/src/db/`, `backend/drizzle/`) over Drizzle + SQLite.
   - **Filesystem** (`backend/uploads/`, `backend/data/`) 用于媒体和运行时状态。
5. **Middleware + Utils** (`backend/src/middleware/`, `backend/src/utils/`): 认证、角色控制、错误处理、共享辅助函数。

### 前端架构

前端按 UI 职责组织：

1. **Pages** (`frontend/src/pages/`): 路由级屏幕。
2. **Components** (`frontend/src/components/`): 可复用的功能组件。
3. **Contexts** (`frontend/src/contexts/`): 跨页面状态管理。
4. **Hooks** (`frontend/src/hooks/`): 用于获取/状态/交互的共享行为。
5. **Utils** (`frontend/src/utils/`): API 包装器、多语言字符串、格式化和媒体辅助函数。

### 数据库模式 (关键表)

定义于 `backend/src/db/schema.ts`:

- `videos`: 视频元数据、路径、标签、播放数据。
- `collections`: 收藏夹元数据。
- `collection_videos`: 收藏夹与视频之间的多对多映射。
- `settings`: 键值对应用设置存储。
- `downloads`: 活动/排队下载状态。
- `download_history`: 历史下载记录。
- `subscriptions`: 频道/播放列表订阅定义。
- `video_downloads`: 源代码级去重跟踪。
- `continuous_download_tasks`: 长期运行的后台下载任务记录。
