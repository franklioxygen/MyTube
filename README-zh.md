<p align="center">
<img width="256" height="256" alt="logo" src="https://github.com/user-attachments/assets/cf900a36-8ed0-41f0-97b1-d330977eaa15" />
</p>


# MyTube

支持 YouTube、Bilibili、Twitch、MissAV 及 [yt-dlp 站点](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) 的自托管视频下载器与播放器。具备频道订阅、自动下载、本地化存储以及面向外部阅读器的私密 RSS 订阅链接。UI 设计精美，支持收藏集分类管理。内置 Cloudflare Tunnel 支持，无需端口映射即可实现安全远程访问。支持 Docker 一键部署。

🚀 100% 提示工程构建，零人工介入代码。
基于 [franklioxygen/agent-workflows](https://github.com/franklioxygen/agent-workflows) 工作流构建。

[![GitHub License](https://img.shields.io/github/license/franklioxygen/mytube)](https://github.com/franklioxygen/mytube)
![Docker Pulls](https://img.shields.io/docker/pulls/franklioxygen/mytube)
[![Discord](https://img.shields.io/badge/Discord-Join_Us-7289DA?logo=discord&logoColor=white)](https://discord.gg/dXn4u9kQGN)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/franklioxygen/MyTube/master.yml)
![GHCR 镜像工作流状态](https://img.shields.io/github/actions/workflow/status/franklioxygen/MyTube/ghcr.yml?label=GHCR%20Image)
[![Lighthouse 性能](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/franklioxygen/MyTube/gh-pages/badges/lighthouse-performance.json)](https://github.com/franklioxygen/MyTube/actions/workflows/lighthouse.yml)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/266f0b53788f463a97230cb0c9d1d890)](https://app.codacy.com/gh/franklioxygen/MyTube/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)
[![Codacy Badge](https://app.codacy.com/project/badge/Coverage/266f0b53788f463a97230cb0c9d1d890)](https://app.codacy.com/gh/franklioxygen/MyTube/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_coverage)
[![GitHub Repo stars](https://img.shields.io/github/stars/franklioxygen/mytube)](https://github.com/franklioxygen/mytube)
[![GitHub Roast score badge](https://ghfind.com/api/badge/franklioxygen)](https://ghfind.com/u/franklioxygen?ref=badge)
[![代码行数](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/franklioxygen/MyTube/gh-pages/badges/lines-of-code.json)](https://github.com/franklioxygen/MyTube/actions/workflows/loc-badge.yml)

[English](README.md) | [更新日志](CHANGELOG.md)

## 在线演示

<p align="center">
 🌐 访问在线演示(只读): <a href="https://mytube-demo.vercel.app">https://mytube-demo.vercel.app</a>
 <br />
 <img width="512" height="320" alt="app-screenshot" src="https://github.com/user-attachments/assets/6889495e-c035-4bbd-9899-977f0f3aa4fb" />
</p>


## 功能特点

- **视频下载**：通过简单的 URL 输入下载 YouTube、Bilibili、Twitch、MissAV 以及其他 yt-dlp 支持的视频。
- **视频上传**：直接上传本地视频文件到您的库，并自动生成缩略图。
- **TMDB 元数据抓取**：基于文件名自动从 TMDB 抓取电影和电视剧元数据（标题、描述、封面、导演、年份、评分）。支持根据站点语言获取本地化内容。
- **并行下载**：支持队列下载，可同时追踪多个下载任务的进度。
- **批量下载**：一次性添加多个视频链接到下载队列。
- **并发下载限制**：设置同时下载的数量限制以管理带宽。
- **云存储集成**：下载后自动将视频和缩略图上传到云存储（OpenList/Alist）。
- **字幕**：自动下载 YouTube / Bilibili 默认语言字幕。
- **实时音频翻译**（管理员，可选）：将正在播放的视频音频流式传输到 Google Gemini 实时翻译，并在播放器字幕菜单中播放翻译后的语音和实时字幕。在 **设置 → 基础 → 视频播放** 中配置（启用、Gemini API 密钥、模型、源/目标语言）。密钥仅保存在服务器端，绝不会发送到浏览器。**隐私提示：** 启用实时翻译期间，视频音频会被传输到 Google Gemini API；转录文本不会被持久化或记录。启用登录时需要管理员账户，且音频来源需为同源（非跨域）。
- **收藏夹**：创建自定义收藏夹以整理您的视频。
- **订阅功能**：管理 YouTube、Bilibili 和 Twitch 频道订阅，并在新内容发布后自动下载。
- **RSS 订阅**：为外部 RSS 阅读器创建私密订阅链接，并可按频道、作者、标签、来源、最近时间范围和条目上限分别配置过滤条件。
- **登录保护**：支持密码登录并可选使用通行密钥 (WebAuthn)。
- **访客用户**：创建具名的只读访客账户，便于安全分享且不允许修改。
- **国际化**：支持多种语言，包括英语、中文、西班牙语、法语、德语、日语、韩语、阿拉伯语、葡萄牙语和俄语。
- **移动端优化**：移动端友好的标签菜单和针对小屏幕优化的布局。
- **Cookie 管理**：支持上传 `cookies.txt` 以启用年龄限制或会员内容的下载。
- **yt-dlp 配置**: 通过用户界面自定义全局 `yt-dlp` 参数、网络代理及其他高级设置。
- **TMDB 集成**：在设置中配置您的 TMDB API 密钥，即可为本地视频文件启用自动元数据抓取。抓取器会智能解析文件名以提取标题并与 TMDB 数据库匹配。
- **Cloudflare Tunnel 集成**: 内置 Cloudflare Tunnel 支持，无需端口转发即可轻松将本地 MyTube 实例暴露到互联网。
- **任务钩子**: 在下载任务的各个阶段（开始、成功、失败、取消）执行自定义 Shell 脚本，以实现集成和自动化。详见 [任务钩子指南](documents/zh/hooks-guide.md)。
- **Telegram 通知**: 当下载任务成功或失败时，通过 Telegram 机器人接收即时通知。
- **浏览器扩展**: 提供 Chrome 扩展，支持直接从浏览器下载视频。支持所有 yt-dlp 支持的站点。

## 浏览器扩展

有关安装和使用说明，请参阅 [浏览器扩展](documents/zh/chrome-extension.md)。

## MikMok

[MikMok](https://github.com/franklioxygen/MikMok) 是 MyTube 的短视频 Web 客户端，可通过 API 连接 MyTube，提供更适合短视频浏览的流式观看体验。

## Android 客户端

[mytube-android](https://github.com/franklioxygen/mytube-android) 是 MyTube 的原生 Android 客户端，通过 API 连接到您的 MyTube 服务器，可在移动设备上浏览和播放视频。

## MCP 服务器

[mytube-mcp](https://github.com/franklioxygen/mytube-mcp) 是 MyTube 的 Model Context Protocol (MCP) 服务器，通过 API 将您的 MyTube 实例暴露给 AI 助手和智能体，使其能够代您搜索、管理和播放您的视频库。

## 目录结构

有关项目结构的详细说明，请参阅 [目录结构](documents/zh/directory-structure.md)。

### 运行时存储目录

默认情况下，媒体文件和缓存位于 `backend/uploads/`：

| 目录 | 用途 |
|---|---|
| `videos/` | 下载的视频文件；启用相关设置时，完整尺寸封面、字幕和电视媒体库伴随文件也会与视频放在一起。 |
| `images/` | 当封面位置设置为独立图片文件夹时，用于保存完整尺寸封面。 |
| `images-small/` | UI 使用的内部小图预览缓存。它会镜像完整尺寸封面的目录结构，可忽略或从媒体服务器媒体库中排除。 |
| `subtitles/` | 当字幕位置设置为独立字幕文件夹时，用于保存字幕文件。 |
| `avatars/` | 应用和媒体服务器导出使用的频道/作者头像。 |
| `cloud-thumbnail-cache/` | 云端媒体缩略图的内部缓存。 |

## 开始使用

**环境要求：** Node.js **20.19+、22.12+、23.x、24.x、25.x 或 26.x**，以及 npm v9+。后端依赖 `better-sqlite3`；不受支持的 Node 版本会在 `npm install` 时失败（在 Windows 上可能显示误导性的 `node-gyp` / Visual Studio 错误）。Docker 镜像内置 Node 22。

有关安装和设置说明，请参阅 [开始使用](documents/zh/getting-started.md)。

## 访客账户

启用登录保护后，管理员可以在 **设置 -> 安全** 中创建具名访客账户。访客账户为只读权限，创建、禁用、删除和重置密码等账户变更会立即生效，无需保存整个设置表单。

已有共享访客密码的安装会自动迁移为 `visitor` 账户。原来使用共享密码的用户可使用用户名 `visitor` 和原密码登录。旧的共享访客密码登录端点仍保留兼容性，但已废弃。

## 部署安全模型

有关管理员三档信任边界与部署安全模型的说明，请参阅 [部署安全模型](documents/zh/deployment-security-model.md)。

## API 端点

有关可用 API 端点的列表，请参阅 [API 端点](documents/zh/api-endpoints.md)。

## 技术栈

### 后端

- **运行时**: Node.js 20.19+、22.12+ 或 23.x–26.x，TypeScript
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
VITE_API_URL=/api
VITE_BACKEND_URL=
```

### 后端 (`backend/.env`)

```env
PORT=5551
# 可选：声明当前部署中管理员的信任边界。
# 可选值：application | container | host
# 默认值：container
# MYTUBE_ADMIN_TRUST_LEVEL=container
```

默认数据与上传路径位于 `backend/data` 和 `backend/uploads`（相对于后端工作目录）。

将 `backend/.env.example` 复制为 `backend/.env` 并按需调整。前端已提供 `frontend/.env`，可使用 `frontend/.env.local` 覆盖默认值。

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
- `rss_tokens`: 私密 RSS 订阅链接、过滤条件、启停状态和访问统计
- `downloads`: 活动下载队列
- `download_history`: 完成的下载历史
- `video_downloads`: 跟踪已下载的视频以防止重复
- `settings`: 应用程序配置

## 贡献

我们欢迎贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何开始、我们的开发工作流程以及代码质量指南。

## 部署

有关 Docker 部署的详细说明（包括 GitHub 官方容器镜像 `ghcr.io/franklioxygen/mytube:latest` 与单容器 `stacks/docker-compose.single-container.yml`），请参阅 [Docker 部署指南](documents/zh/docker-guide.md).
有关 `application` / `container` / `host` 三档管理员信任边界，请参阅 [部署安全模型](documents/zh/deployment-security-model.md)。

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
