# API 端点

除特殊说明外，所有 API 路由均挂载在 `/api` 下。

## 视频下载与搜索

- `GET /api/search` - 在线搜索视频 (YouTube)
  - 查询参数: `query` (必需), `limit` (可选, 默认: 8), `offset` (可选, 默认: 1)
- `POST /api/download` - 从支持的平台下载视频
  - 请求体: `{ youtubeUrl: string, ...options }`
  - 支持: YouTube、Bilibili、MissAV 以及所有 yt-dlp 支持的网站
- `GET /api/check-video-download` - 检查视频是否已下载
  - 查询参数: `url` (必需)
  - 返回: `{ found: boolean, status: 'exists' | 'deleted', videoId?: string, ... }`
- `GET /api/check-bilibili-parts` - 检查 Bilibili 视频是否包含多个分P
  - 查询参数: `url` (必需)
- `GET /api/check-bilibili-collection` - 检查 Bilibili URL 是否为合集/系列
  - 查询参数: `url` (必需)
- `GET /api/check-playlist` - 检查 URL 是否为受支持的播放列表
  - 查询参数: `url` (必需)
- `GET /api/download-status` - 获取下载状态
  - 返回: `{ activeDownloads: DownloadInfo[], queuedDownloads: DownloadInfo[] }`

## 视频管理

- `POST /api/upload` - 上传本地视频文件
  - 多部分表单数据: `video` (文件)
  - 自动生成缩略图
- `GET /api/videos` - 获取所有已下载的视频
  - 查询参数: `page` (可选), `limit` (可选), `sortBy` (可选), `order` (可选), `search` (可选), `author` (可选), `tags` (可选)
- `GET /api/mount-video/:id` - 服务挂载目录视频文件
  - 支持 HTTP Range 请求进行流式传输
- `GET /api/videos/:id` - 通过 ID 获取特定视频
- `PUT /api/videos/:id` - 更新视频详情
  - 请求体: `{ title?, author?, tags?, rating?, ... }`
- `POST /api/videos/:id/subtitles` - 为视频上传字幕
  - 多部分表单数据: `subtitle` (文件)
  - 请求体: `language` (可选)
- `DELETE /api/videos/:id` - 删除视频及其文件
- `GET /api/videos/:id/comments` - 获取视频评论 (如果可用)
- `POST /api/videos/:id/rate` - 评价视频 (1-5 星)
  - 请求体: `{ rating: number }`
- `POST /api/videos/:id/refresh-thumbnail` - 刷新视频缩略图
- `POST /api/videos/:id/view` - 增加观看次数
- `PUT /api/videos/:id/progress` - 更新播放进度
  - 请求体: `{ progress: number }` (秒)
- `GET /api/videos/author-channel-url` - 获取视频的作者频道 URL
  - 查询参数: `sourceUrl` (必需)
  - 返回: `{ success: boolean, channelUrl: string | null }`

## 下载管理
- `POST /api/downloads/channel-playlists` - 处理频道播放列表下载 (一次性)
  - 请求体: `{ url: string }`
- `POST /api/downloads/cancel/:id` - 取消活动下载
- `DELETE /api/downloads/queue/:id` - 从队列中移除下载
- `DELETE /api/downloads/queue` - 清空整个下载队列
- `GET /api/downloads/history` - 获取下载历史
  - 查询参数: `page` (可选), `limit` (可选)
- `DELETE /api/downloads/history/:id` - 从下载历史中移除项目
- `DELETE /api/downloads/history` - 清空整个下载历史

## 收藏夹

- `GET /api/collections` - 获取所有收藏夹
- `POST /api/collections` - 创建新收藏夹
  - 请求体: `{ name: string, videoIds?: string[] }`
- `PUT /api/collections/:id` - 更新收藏夹 (添加/移除视频)
  - 请求体: `{ name?: string, videoIds?: string[], action?: 'add' | 'remove' }`
- `DELETE /api/collections/:id` - 删除收藏夹

## 订阅

- `GET /api/subscriptions` - 获取所有订阅
- `POST /api/subscriptions` - 创建新订阅
  - 请求体: `{ authorUrl: string, interval: number, platform?: string }`
  - `interval`: 检查间隔（分钟）
  - `platform`: 'YouTube' (默认) 或 'Bilibili'
- `POST /api/subscriptions/playlist` - 创建新的播放列表订阅
  - 请求体: `{ playlistUrl: string, interval: number, collectionName: string, downloadAll?: boolean }`
- `POST /api/subscriptions/channel-playlists` - 订阅频道的所有播放列表
  - 请求体: `{ url: string, interval: number, downloadAllPrevious?: boolean }`
- `PUT /api/subscriptions/:id/pause` - 暂停订阅
- `PUT /api/subscriptions/:id/resume` - 恢复订阅
- `DELETE /api/subscriptions/:id` - 删除订阅

## 持续下载任务 (订阅)

- `GET /api/subscriptions/tasks` - 获取所有持续下载任务
  - 查询参数: `page` (可选), `limit` (可选)
- `POST /api/subscriptions/tasks/playlist` - 创建新的播放列表下载任务
  - 请求体: `{ playlistUrl: string, collectionName: string }`
- `PUT /api/subscriptions/tasks/:id/pause` - 暂停持续下载任务
- `PUT /api/subscriptions/tasks/:id/resume` - 恢复持续下载任务
- `DELETE /api/subscriptions/tasks/:id` - 取消持续下载任务
- `DELETE /api/subscriptions/tasks/:id/delete` - 删除任务记录
- `DELETE /api/subscriptions/tasks/clear-finished` - 清除所有已完成的任务

## 设置与密码

- `GET /api/settings` - 获取应用设置
- `POST /api/settings` - 更新应用设置
  - 请求体: `{ [key: string]: any }` - 设置对象
- `POST /api/settings/tags/rename` - 重命名标签
  - 请求体: `{ oldTag: string, newTag: string }`
- `GET /api/settings/cloudflared/status` - 获取 Cloudflare Tunnel 状态
- `POST /api/settings/migrate` - 从 JSON 迁移数据到 SQLite
- `POST /api/settings/delete-legacy` - 删除旧的 JSON 数据文件
- `POST /api/settings/format-filenames` - 根据设置格式化视频文件名
- `GET /api/settings/password-enabled` - 检查是否启用了密码保护
- `GET /api/settings/reset-password-cooldown` - 获取密码重置冷却时间
- `POST /api/settings/verify-admin-password` - 验证管理员密码
  - 请求体: `{ password: string }`
- `POST /api/settings/verify-visitor-password` - 验证访客密码
  - 请求体: `{ password: string }`
- `POST /api/settings/verify-password` - 验证登录密码 (已废弃)
  - 请求体: `{ password: string }`
- `POST /api/settings/reset-password` - 重置登录密码
  - 请求体: `{ oldPassword: string, newPassword: string }`
- `POST /api/settings/logout` - 退出当前会话

## 通行密钥管理

- `GET /api/settings/passkeys` - 获取所有注册的通行密钥
- `GET /api/settings/passkeys/exists` - 检查是否已注册任何通行密钥
- `POST /api/settings/passkeys/register` - 开始通行密钥注册
- `POST /api/settings/passkeys/register/verify` - 验证通行密钥注册
- `POST /api/settings/passkeys/authenticate` - 开始通行密钥认证
- `POST /api/settings/passkeys/authenticate/verify` - 验证通行密钥认证
- `DELETE /api/settings/passkeys` - 删除所有通行密钥

## Cookies

- `POST /api/settings/upload-cookies` - 上传 cookies.txt 以供 yt-dlp 使用
  - 多部分表单数据: `file` (cookies.txt)
- `POST /api/settings/delete-cookies` - 删除 cookies.txt
- `GET /api/settings/check-cookies` - 检查 cookies.txt 是否存在

## 任务钩子

- `GET /api/settings/hooks/status` - 获取所有钩子的状态
- `POST /api/settings/hooks/:name` - 上传钩子脚本
  - 多部分表单数据: `file` (脚本文件)
  - 参数: `name` (钩子名称, 例如 `task_success`)
- `DELETE /api/settings/hooks/:name` - 删除钩子脚本

## 数据库备份

- `GET /api/settings/export-database` - 导出数据库备份文件
- `POST /api/settings/import-database` - 从备份文件导入数据库
  - 多部分表单数据: `file` (数据库备份文件)
- `GET /api/settings/last-backup-info` - 获取最后一个数据库备份的信息
- `POST /api/settings/restore-from-last-backup` - 从最后一个备份恢复数据库
- `POST /api/settings/cleanup-backup-databases` - 清理旧的备份数据库文件

## 文件管理

- `POST /api/scan-files` - 扫描上传目录中的现有视频文件
- `POST /api/scan-mount-directories` - 扫描挂载目录中的视频文件
  - 请求体: `{ directories: string[] }`
- `POST /api/cleanup-temp-files` - 清理临时下载文件

## 云存储

- `GET /api/cloud/signed-url` - 获取云存储签名 URL
  - 查询参数: `filename` (必需), `type` (可选: `video` 或 `thumbnail`)
- `POST /api/cloud/sync` - 同步本地视频到云存储 (以 JSON 行流式返回进度)
- `DELETE /api/cloud/thumbnail-cache` - 清空缩略图缓存
- `GET /api/cloud/thumbnail-cache/:filename` - 访问缓存的云端缩略图
- `GET /cloud/videos/:filename` - 重定向到云端视频签名 URL
- `GET /cloud/images/:filename` - 重定向到云端缩略图签名 URL（或本地缓存）

## 系统

- `GET /api/system/version` - 获取当前版本与最新版本信息
  - 返回: `{ currentVersion, latestVersion, releaseUrl, hasUpdate }`
