# MyTube

一个 YouTube/Bilibili/MissAV 视频下载和播放应用，支持频道订阅与自动下载，允许您将视频及其缩略图本地保存。将您的视频整理到收藏夹中，以便轻松访问和管理。现已支持[yt-dlp 所有网址](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md##)，包括微博，小红书，X.com 等。

[![GitHub License](https://img.shields.io/github/license/franklioxygen/mytube)](https://github.com/franklioxygen/mytube)
![Docker Pulls](https://img.shields.io/docker/pulls/franklioxygen/mytube)
[![Discord](https://img.shields.io/badge/Discord-Join_Us-7289DA?logo=discord&logoColor=white)](https://discord.gg/dXn4u9kQGN)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/franklioxygen/MyTube/master.yml)
[![GitHub Repo stars](https://img.shields.io/github/stars/franklioxygen/mytube)](https://github.com/franklioxygen/mytube)

[English](README.md) | [更新日志](CHANGELOG.md)

## 在线演示

🌐 **访问在线演示(只读): [https://mytube-demo.vercel.app](https://mytube-demo.vercel.app)**

[![Watch the video](https://img.youtube.com/vi/O5rMqYffXpg/maxresdefault.jpg)](https://youtu.be/O5rMqYffXpg)

## 功能特点

- **视频下载**：通过简单的 URL 输入下载 YouTube、Bilibili 和 MissAV 视频。
- **视频上传**：直接上传本地视频文件到您的库，并自动生成缩略图。
- **Bilibili 支持**：支持下载单个视频、多 P 视频以及整个合集/系列。
- **并行下载**：支持队列下载，可同时追踪多个下载任务的进度。
- **批量下载**：一次性添加多个视频链接到下载队列。
- **并发下载限制**：设置同时下载的数量限制以管理带宽。
- **本地库**：自动保存视频缩略图和元数据，提供丰富的浏览体验。
- **视频播放器**：自定义播放器，支持播放/暂停、循环、快进/快退、全屏和调光控制。
- **字幕**：自动下载 YouTube / Bilibili 默认语言字幕。
- **搜索功能**：支持在本地库中搜索视频，或在线搜索 YouTube 视频。
- **收藏夹**：创建自定义收藏夹以整理您的视频。
- **订阅功能**：订阅您喜爱的频道，并在新视频发布时自动下载。
- **登录保护**：通过密码登录页面保护您的应用。
- **国际化**：支持多种语言，包括英语、中文、西班牙语、法语、德语、日语、韩语、阿拉伯语和葡萄牙语。
- **分页功能**：支持分页浏览，高效管理大量视频。
- **视频评分**：使用 5 星评级系统为您的视频评分。
- **移动端优化**：移动端友好的标签菜单和针对小屏幕优化的布局。
- **临时文件清理**：直接从设置中清理临时下载文件以管理存储空间。
- **视图模式**：在主页上切换收藏夹视图和视频视图。
- **Cookie 管理**：支持上传 `cookies.txt` 以启用年龄限制或会员内容的下载。
- **yt-dlp 配置**: 通过用户界面自定义全局 `yt-dlp` 参数、网络代理及其他高级设置。
- **访客模式**：启用只读模式，允许查看视频但无法进行修改。非常适合与他人分享您的视频库。
- **云存储集成**：下载后自动将视频和缩略图上传到云存储（OpenList/Alist）。
- **Cloudflare Tunnel 集成**: 内置 Cloudflare Tunnel 支持，无需端口转发即可轻松将本地 MyTube 实例暴露到互联网。

## 目录结构

有关项目结构的详细说明，请参阅 [目录结构](documents/zh/directory-structure.md)。

## 开始使用

有关安装和设置说明，请参阅 [开始使用](documents/zh/getting-started.md)。

## API 端点

有关可用 API 端点的列表，请参阅 [API 端点](documents/zh/api-endpoints.md)。

## 技术栈

### 后端

- **运行时**: Node.js with TypeScript
- **框架**: Express.js
- **数据库**: SQLite with Drizzle ORM
- **测试**: Vitest
- **架构**: 分层架构 (路由 → 控制器 → 服务 → 数据库)

### 前端

- **框架**: React 19 with TypeScript
- **构建工具**: Vite
- **UI 库**: Material-UI (MUI)
- **状态管理**: React Context API
- **路由**: React Router v7
- **HTTP 客户端**: Axios with React Query

### 关键架构特性

- **模块化存储服务**: 拆分为专注的模块以提高可维护性
- **下载器模式**: 用于平台特定实现的抽象基类
- **数据库迁移**: 使用 Drizzle Kit 自动更新模式
- **下载队列管理**: 支持队列的并发下载
- **视频下载跟踪**: 防止跨会话重复下载

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
SUBTITLES_DIR=uploads/subtitles
DATA_DIR=data
MAX_FILE_SIZE=500000000
```

复制前端和后端目录中的 `.env.example` 文件以创建您自己的 `.env` 文件。

## 数据库

MyTube 使用 **SQLite** 和 **Drizzle ORM** 进行数据持久化。数据库在首次启动时自动创建和迁移：

- **位置**: `backend/data/mytube.db`
- **迁移**: 在服务器启动时自动运行
- **模式**: 通过 Drizzle Kit 迁移管理
- **旧版支持**: 提供迁移工具以从基于 JSON 的存储转换

关键数据库表：

- `videos`: 视频元数据和文件路径
- `collections`: 视频收藏夹/播放列表
- `subscriptions`: 频道/创作者订阅
- `downloads`: 活动下载队列
- `download_history`: 完成的下载历史
- `video_downloads`: 跟踪已下载的视频以防止重复
- `settings`: 应用程序配置

## 贡献

我们欢迎贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何开始、我们的开发工作流程以及代码质量指南。

## 部署

有关如何使用 Docker 部署 MyTube 的详细说明，请参阅 [Docker 部署指南](documents/zh/docker-guide.md).

## 星标历史

<a href="https://www.star-history.com/#franklioxygen/MyTube&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&legend=bottom-right" />
 </picture>
</a>

## 免责声明

- 使用目的与限制 本软件（及相关代码、文档）仅供个人学习、研究及技术交流使用。严禁将本软件用于任何形式的商业用途，或利用本软件进行违反国家法律法规的犯罪活动。

- 责任界定 开发者对用户使用本软件的具体行为概不知情，亦无法控制。因用户非法或不当使用本软件（包括但不限于侵犯第三方版权、下载违规内容等）而产生的任何法律责任、纠纷或损失，均由用户自行承担，开发者不承担任何直接、间接或连带责任。

- 二次开发与分发 本项目代码开源，任何个人或组织基于本项目代码进行修改、二次开发时，应遵守开源协议。 特别声明： 若第三方人为修改代码以规避、去除本软件原有的用户认证机制/安全限制，并进行公开分发或传播，由此引发的一切责任事件及法律后果，需由该代码修改发布者承担全部责任。我们强烈不建议用户规避或篡改任何安全验证机制。

- 非盈利声明 本项目为完全免费的开源项目。开发者从未在任何平台发布捐赠信息，本软件本身不收取任何费用，亦不提供任何形式的付费增值服务。任何声称代表本项目收取费用、销售软件或寻求捐赠的信息均为虚假信息，请用户仔细甄别，谨防上当受骗。

## 许可证

MIT
