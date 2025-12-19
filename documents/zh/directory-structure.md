# 目录结构

```
mytube/
├── backend/                          # Express.js 后端 (TypeScript)
│   ├── src/                          # 源代码
│   │   ├── __tests__/                # 测试文件
│   │   │   ├── controllers/          # 控制器测试
│   │   │   ├── middleware/           # 中间件测试
│   │   │   ├── services/             # 服务测试
│   │   │   └── utils/                # 工具测试
│   │   ├── config/                   # 配置文件
│   │   │   └── paths.ts              # 路径配置
│   │   ├── controllers/              # 路由控制器
│   │   │   ├── cleanupController.ts  # 清理操作
│   │   │   ├── collectionController.ts
│   │   │   ├── downloadController.ts
│   │   │   ├── scanController.ts
│   │   │   ├── settingsController.ts
│   │   │   ├── subscriptionController.ts
│   │   │   ├── videoController.ts
│   │   │   ├── videoDownloadController.ts
│   │   │   └── videoMetadataController.ts
│   │   ├── db/                       # 数据库层
│   │   │   ├── index.ts              # 数据库连接 (Drizzle ORM)
│   │   │   ├── migrate.ts            # 迁移运行器
│   │   │   └── schema.ts             # 数据库模式定义
│   │   ├── errors/                   # 自定义错误类
│   │   │   └── DownloadErrors.ts
│   │   ├── middleware/               # Express 中间件
│   │   │   ├── errorHandler.ts       # 错误处理中间件
│   │   │   ├── visitorModeMiddleware.ts # 访客模式（只读）中间件
│   │   │   └── visitorModeSettingsMiddleware.ts # 访客模式设置中间件
│   │   ├── routes/                   # API 路由定义
│   │   │   ├── api.ts                # 主 API 路由
│   │   │   └── settingsRoutes.ts     # 设置相关路由
│   │   ├── scripts/                  # 实用脚本
│   │   │   ├── cleanVttFiles.ts
│   │   │   └── rescanSubtitles.ts
│   │   ├── services/                 # 业务逻辑服务
│   │   │   ├── downloaders/          # 下载器实现
│   │   │   │   ├── BaseDownloader.ts # 抽象基类
│   │   │   │   ├── BilibiliDownloader.ts
│   │   │   │   ├── MissAVDownloader.ts
│   │   │   │   ├── YtDlpDownloader.ts
│   │   │   │   ├── bilibili/         # Bilibili 特定模块
│   │   │   │   │   ├── bilibiliApi.ts
│   │   │   │   │   ├── bilibiliCollection.ts
│   │   │   │   │   ├── bilibiliCookie.ts
│   │   │   │   │   ├── bilibiliSubtitle.ts
│   │   │   │   │   ├── bilibiliVideo.ts
│   │   │   │   │   └── types.ts
│   │   │   │   └── ytdlp/            # yt-dlp 特定模块
│   │   │   │       ├── types.ts
│   │   │   │       ├── ytdlpChannel.ts
│   │   │   │       ├── ytdlpConfig.ts
│   │   │   │       ├── ytdlpHelpers.ts
│   │   │   │       ├── ytdlpMetadata.ts
│   │   │   │       ├── ytdlpSearch.ts
│   │   │   │       ├── ytdlpSubtitle.ts
│   │   │   │       └── ytdlpVideo.ts
│   │   │   ├── storageService/       # 模块化存储服务
│   │   │   │   ├── index.ts          # 主导出文件
│   │   │   │   ├── types.ts          # 类型定义
│   │   │   │   ├── initialization.ts  # 数据库初始化
│   │   │   │   ├── downloadStatus.ts # 活动/队列下载
│   │   │   │   ├── downloadHistory.ts # 下载历史
│   │   │   │   ├── videoDownloadTracking.ts # 重复下载预防
│   │   │   │   ├── settings.ts       # 应用设置
│   │   │   │   ├── videos.ts         # 视频 CRUD 操作
│   │   │   │   ├── collections.ts    # 收藏夹操作
│   │   │   │   └── fileHelpers.ts    # 文件系统工具
│   │   │   ├── CloudStorageService.ts
│   │   │   ├── commentService.ts
│   │   │   ├── downloadManager.ts    # 下载队列管理
│   │   │   ├── downloadService.ts
│   │   │   ├── loginAttemptService.ts
│   │   │   ├── metadataService.ts
│   │   │   ├── migrationService.ts
│   │   │   ├── storageService.ts     # 向后兼容导出
│   │   │   ├── subscriptionService.ts
│   │   │   ├── subtitleService.ts
│   │   │   └── thumbnailService.ts
│   │   ├── utils/                    # 工具函数
│   │   │   ├── bccToVtt.ts           # 字幕转换
│   │   │   ├── downloadUtils.ts
│   │   │   ├── helpers.ts
│   │   │   ├── logger.ts
│   │   │   ├── progressTracker.ts
│   │   │   ├── response.ts
│   │   │   └── ytDlpUtils.ts
│   │   ├── server.ts                 # 主服务器文件
│   │   └── version.ts                # 版本信息
│   ├── bgutil-ytdlp-pot-provider/    # PO Token 提供者插件
│   │   ├── plugin/                   # Python 插件
│   │   │   └── yt_dlp_plugins/
│   │   └── server/                   # TypeScript 服务器
│   │       └── src/
│   ├── data/                         # 数据目录
│   │   ├── mytube.db                 # SQLite 数据库
│   │   ├── cookies.txt               # yt-dlp cookies (可选)
│   │   └── login-attempts.json       # 登录尝试跟踪
│   ├── drizzle/                      # 数据库迁移
│   │   └── meta/                     # 迁移元数据
│   ├── uploads/                      # 上传文件目录
│   │   ├── videos/                   # 下载的视频
│   │   ├── images/                   # 下载的缩略图
│   │   └── subtitles/                 # 下载的字幕
│   ├── dist/                         # 编译后的 JavaScript
│   ├── coverage/                     # 测试覆盖率报告
│   ├── Dockerfile                    # 后端 Docker 镜像
│   ├── drizzle.config.ts             # Drizzle ORM 配置
│   ├── nodemon.json                  # Nodemon 配置
│   ├── package.json                  # 后端依赖
│   ├── tsconfig.json                 # TypeScript 配置
│   └── vitest.config.ts              # Vitest 测试配置
├── frontend/                         # React.js 前端 (Vite + TypeScript)
│   ├── src/                          # 源代码
│   │   ├── __tests__/                # 测试文件
│   │   ├── assets/                   # 静态资源
│   │   │   └── logo.svg
│   │   ├── components/               # React 组件
│   │   │   ├── Header/               # 头部组件组
│   │   │   │   ├── ActionButtons.tsx
│   │   │   │   ├── DownloadsMenu.tsx
│   │   │   │   ├── index.tsx
│   │   │   │   ├── Logo.tsx
│   │   │   │   ├── ManageMenu.tsx
│   │   │   │   ├── MobileMenu.tsx
│   │   │   │   ├── SearchInput.tsx
│   │   │   │   └── types.ts
│   │   │   ├── ManagePage/           # 管理页面组件
│   │   │   │   ├── CollectionsTable.tsx
│   │   │   │   └── VideosTable.tsx
│   │   │   ├── Settings/             # 设置页面组件
│   │   │   │   ├── AdvancedSettings.tsx
│   │   │   │   ├── CloudDriveSettings.tsx
│   │   │   │   ├── CookieSettings.tsx
│   │   │   │   ├── DatabaseSettings.tsx
│   │   │   │   ├── DownloadSettings.tsx
│   │   │   │   ├── GeneralSettings.tsx
│   │   │   │   ├── SecuritySettings.tsx
│   │   │   │   ├── TagsSettings.tsx
│   │   │   │   ├── VideoDefaultSettings.tsx
│   │   │   │   └── YtDlpSettings.tsx
│   │   │   ├── VideoPlayer/           # 视频播放器组件
│   │   │   │   ├── CommentsSection.tsx
│   │   │   │   ├── UpNextSidebar.tsx
│   │   │   │   ├── VideoControls.tsx
│   │   │   │   ├── VideoInfo.tsx
│   │   │   │   └── VideoInfo/         # 视频信息子组件
│   │   │   │       ├── EditableTitle.tsx
│   │   │   │       ├── VideoActionButtons.tsx
│   │   │   │       ├── VideoAuthorInfo.tsx
│   │   │   │       ├── VideoDescription.tsx
│   │   │   │       ├── VideoMetadata.tsx
│   │   │   │       ├── VideoRating.tsx
│   │   │   │       └── VideoTags.tsx
│   │   │   ├── AlertModal.tsx
│   │   │   ├── AnimatedRoutes.tsx
│   │   │   ├── AuthorsList.tsx
│   │   │   ├── BatchDownloadModal.tsx
│   │   │   ├── BilibiliPartsModal.tsx
│   │   │   ├── CollectionCard.tsx
│   │   │   ├── CollectionModal.tsx
│   │   │   ├── Collections.tsx
│   │   │   ├── ConfirmationModal.tsx
│   │   │   ├── DeleteCollectionModal.tsx
│   │   │   ├── Disclaimer.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── PageTransition.tsx
│   │   │   ├── SubscribeModal.tsx
│   │   │   ├── TagsList.tsx
│   │   │   ├── UploadModal.tsx
│   │   │   └── VideoCard.tsx
│   │   ├── contexts/                 # React 上下文用于状态管理
│   │   │   ├── AuthContext.tsx
│   │   │   ├── CollectionContext.tsx
│   │   │   ├── DownloadContext.tsx
│   │   │   ├── LanguageContext.tsx
│   │   │   ├── SnackbarContext.tsx
│   │   │   ├── ThemeContext.tsx
│   │   │   └── VideoContext.tsx
│   │   ├── hooks/                    # 自定义 React hooks
│   │   │   ├── useDebounce.ts
│   │   │   ├── useShareVideo.ts
│   │   │   └── useVideoResolution.ts
│   │   ├── pages/                    # 页面组件
│   │   │   ├── AuthorVideos.tsx
│   │   │   ├── CollectionPage.tsx
│   │   │   ├── DownloadPage/          # 下载页面组件
│   │   │   │   ├── ActiveDownloadsTab.tsx
│   │   │   │   ├── CustomTabPanel.tsx
│   │   │   │   ├── HistoryItem.tsx
│   │   │   │   ├── HistoryTab.tsx
│   │   │   │   ├── index.tsx
│   │   │   │   └── QueueTab.tsx
│   │   │   ├── Home.tsx
│   │   │   ├── InstructionPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── ManagePage.tsx
│   │   │   ├── SearchPage.tsx
│   │   │   ├── SearchResults.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   ├── SubscriptionsPage.tsx
│   │   │   └── VideoPlayer.tsx
│   │   ├── utils/                    # 工具和多语言
│   │   │   ├── locales/              # 国际化文件
│   │   │   │   ├── ar.ts             # 阿拉伯语
│   │   │   │   ├── de.ts             # 德语
│   │   │   │   ├── en.ts             # 英语
│   │   │   │   ├── es.ts             # 西班牙语
│   │   │   │   ├── fr.ts             # 法语
│   │   │   │   ├── ja.ts             # 日语
│   │   │   │   ├── ko.ts             # 韩语
│   │   │   │   ├── pt.ts             # 葡萄牙语
│   │   │   │   ├── ru.ts             # 俄语
│   │   │   │   └── zh.ts             # 中文
│   │   │   ├── consoleManager.ts
│   │   │   ├── constants.ts
│   │   │   ├── formatUtils.ts
│   │   │   ├── recommendations.ts
│   │   │   └── translations.ts
│   │   ├── App.tsx                   # 主应用组件
│   │   ├── App.css
│   │   ├── index.css
│   │   ├── main.tsx                  # 应用入口点
│   │   ├── setupTests.ts
│   │   ├── theme.ts                  # Material-UI 主题配置
│   │   ├── types.ts                  # TypeScript 类型定义
│   │   ├── version.ts                # 版本信息
│   │   └── vite-env.d.ts
│   ├── dist/                         # 生产构建输出
│   ├── public/                       # 公共静态文件
│   ├── Dockerfile                    # 前端 Docker 镜像
│   ├── entrypoint.sh                 # Docker 入口脚本
│   ├── eslint.config.js              # ESLint 配置
│   ├── index.html                    # HTML 模板
│   ├── nginx.conf                    # Nginx 配置
│   ├── package.json                  # 前端依赖
│   ├── tsconfig.json                 # TypeScript 配置
│   ├── tsconfig.node.json
│   └── vite.config.js                # Vite 配置
├── documents/                         # 文档
│   ├── en/                           # 英文文档
│   │   ├── api-endpoints.md
│   │   ├── directory-structure.md
│   │   ├── docker-guide.md
│   │   └── getting-started.md
│   └── zh/                           # 中文文档
│       ├── api-endpoints.md
│       ├── directory-structure.md
│       ├── docker-guide.md
│       └── getting-started.md
├── data/                             # 根数据目录 (可选)
│   └── mytube.db
├── build-and-push.sh                 # Docker 构建和推送脚本
├── docker-compose.yml                # Docker Compose 配置
├── CHANGELOG.md                      # 更新日志
├── CODE_OF_CONDUCT.md                # 行为准则
├── CONTRIBUTING.md                   # 贡献指南
├── LICENSE                           # MIT 许可证
├── README.md                         # 英文 README
├── README-zh.md                      # 中文 README
├── RELEASING.md                      # 发布流程指南
├── SECURITY.md                       # 安全策略
└── package.json                      # 运行两个应用的根 package.json
```

## 架构概述

### 后端架构

后端遵循**分层架构**模式：

1. **路由层** (`routes/`): 定义 API 端点并将其映射到控制器
2. **控制器层** (`controllers/`): 处理 HTTP 请求/响应并委托给服务
3. **服务层** (`services/`): 包含业务逻辑
   - **下载器**: 用于平台特定下载器的抽象基类模式
   - **存储服务**: 拆分为专注模块的模块化服务
   - **支持服务**: 下载管理、订阅、元数据等
4. **数据库层** (`db/`): 使用 Drizzle ORM 和 SQLite 进行数据持久化
5. **工具层** (`utils/`): 共享工具函数

### 前端架构

前端遵循**基于组件的架构**：

1. **页面** (`pages/`): 顶级路由组件
2. **组件** (`components/`): 按功能组织的可重用 UI 组件
3. **上下文** (`contexts/`): 用于全局状态管理的 React Context API
4. **Hooks** (`hooks/`): 用于可重用逻辑的自定义 React hooks
5. **工具** (`utils/`): 辅助函数和国际化

### 数据库模式

应用程序使用 **SQLite** 和 **Drizzle ORM** 进行数据持久化。关键表包括：

- `videos`: 视频元数据和文件路径
- `collections`: 视频收藏夹/播放列表
- `collection_videos`: 视频和收藏夹之间的多对多关系
- `subscriptions`: 频道/创作者订阅
- `downloads`: 活动下载队列
- `download_history`: 完成的下载历史
- `video_downloads`: 跟踪已下载的视频以防止重复
- `settings`: 应用程序配置
