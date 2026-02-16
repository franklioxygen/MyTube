# API 端点

除特殊说明外，所有 API 路由均挂载在 `/api` 下。

## 认证与访问说明

- 认证基于 Cookie (HTTP-only JWT Cookie)。同时也接受 Authorization 标头以保证向后兼容性。
- 启用密码登录后，未认证用户只能访问与登录相关的公开端点。
- 访客角色对大多数资源仅有只读权限。

## 视频下载与搜索

- `GET /api/search` - 在线搜索视频 (YouTube)
  - 查询参数: `query` (必需), `limit` (可选, 默认: `8`), `offset` (可选, 默认: `1`)
- `POST /api/download` - 添加视频下载任务
  - 请求体: `{ youtubeUrl: string, downloadAllParts?: boolean, collectionName?: string, downloadCollection?: boolean, collectionInfo?: object, forceDownload?: boolean }`
  - 支持: YouTube、Bilibili、MissAV 以及其他 yt-dlp 支持的网站
- `GET /api/check-video-download` - 检查源 URL 是否已被下载过
  - 查询参数: `url` (必需)
- `GET /api/check-bilibili-parts` - 检查 Bilibili 视频是否有多个分P
  - 查询参数: `url` (必需)
- `GET /api/check-bilibili-collection` - 检查 Bilibili URL 是否为合集/系列
  - 查询参数: `url` (必需)
- `GET /api/check-playlist` - 检查 URL 是否为播放列表 (支持 YouTube/Bilibili)
  - 查询参数: `url` (必需)
- `GET /api/download-status` - 获取正在进行和排队的下载任务

## 视频管理

- `POST /api/upload` - 上传本地视频文件
  - 多部分表单数据: `video` (必需), `title` (可选), `author` (可选)
- `GET /api/videos` - 获取所有视频 (当前实现无服务器端分页/过滤)
- `GET /api/videos/:id` -通过 ID 获取单个视频
- `GET /api/mount-video/:id` - 通过视频 ID 流式传输挂载目录视频 (支持 Range)
- `PUT /api/videos/:id` - 更新视频元数据
  - 请求体允许: `{ title?, tags?, visibility?, subtitles? }`
- `POST /api/videos/:id/subtitles` - 为视频上传字幕文件
  - 多部分表单数据: `subtitle` (必需), `language` (可选)
  - 支持的上传格式: `.vtt`, `.srt`, `.ass`, `.ssa`
- `DELETE /api/videos/:id` - 删除视频记录及相关文件
- `GET /api/videos/:id/comments` - 获取视频评论 (如可用)
- `POST /api/videos/:id/rate` - 评价视频
  - 请求体: `{ rating: number }` 其中 `1 <= rating <= 5`
- `POST /api/videos/:id/refresh-thumbnail` - 从随机帧重新生成缩略图
- `POST /api/videos/:id/view` - 增加观看次数
- `PUT /api/videos/:id/progress` - 保存播放进度
  - 请求体: `{ progress: number }`
- `GET /api/videos/author-channel-url` - 解析源 URL 中的频道/作者 URL
  - 查询参数: `sourceUrl` (必需)

## 下载队列与历史

- `POST /api/downloads/channel-playlists` - 一次性流程: 下载频道中的所有播放列表
  - 请求体: `{ url: string }`
- `POST /api/downloads/cancel/:id` - 取消正在进行的下载
- `DELETE /api/downloads/queue/:id` - 移除排队的下载
- `DELETE /api/downloads/queue` - 清空下载队列
- `GET /api/downloads/history` - 获取下载历史
- `DELETE /api/downloads/history/:id` - 删除一条历史记录
- `DELETE /api/downloads/history` - 清空下载历史

## 收藏夹

- `GET /api/collections` - 获取所有收藏夹
- `POST /api/collections` - 创建收藏夹
  - 请求体: `{ name: string, videoId?: string }`
- `PUT /api/collections/:id` - 更新收藏夹
  - 请求体: `{ name?: string, videoId?: string, action?: "add" | "remove" }`
- `DELETE /api/collections/:id` - 删除收藏夹
  - 查询参数: `deleteVideos=true` (可选, 同时删除收藏夹内的视频)

## 订阅

- `GET /api/subscriptions` - 获取所有订阅
- `POST /api/subscriptions` - 创建订阅
  - 请求体: `{ url: string, interval: number, authorName?: string, downloadAllPrevious?: boolean, downloadShorts?: boolean }`
- `PUT /api/subscriptions/:id/pause` - 暂停订阅
- `PUT /api/subscriptions/:id/resume` - 恢复订阅
- `DELETE /api/subscriptions/:id` - 删除订阅
- `POST /api/subscriptions/playlist` - 创建播放列表订阅
  - 请求体: `{ playlistUrl: string, interval: number, collectionName: string, downloadAll?: boolean, collectionInfo?: object }`
- `POST /api/subscriptions/channel-playlists` - 订阅频道的所有播放列表并创建监视器
  - 请求体: `{ url: string, interval: number, downloadAllPrevious?: boolean }`

## 持续下载任务

- `GET /api/subscriptions/tasks` - 获取所有持续下载任务
- `POST /api/subscriptions/tasks/playlist` - 创建单个播放列表持续任务
  - 请求体: `{ playlistUrl: string, collectionName: string }`
- `PUT /api/subscriptions/tasks/:id/pause` - 暂停任务
- `PUT /api/subscriptions/tasks/:id/resume` - 恢复任务
- `DELETE /api/subscriptions/tasks/:id` - 取消任务
- `DELETE /api/subscriptions/tasks/:id/delete` - 删除任务记录
- `DELETE /api/subscriptions/tasks/clear-finished` - 清除已完成的任务

## 设置

- `GET /api/settings` - 获取应用设置 (不包含密码哈希)
- `PATCH /api/settings` - 部分更新设置
  - 请求体: 部分设置对象
- `POST /api/settings/migrate` - 将旧版 JSON 数据迁移至 SQLite
- `POST /api/settings/delete-legacy` - 删除旧版 JSON 数据文件
- `POST /api/settings/format-filenames` - 格式化旧版文件名
- `GET /api/settings/cloudflared/status` - 获取 Cloudflared 隧道状态
- `POST /api/settings/tags/rename` - 重命名标签
  - 请求体: `{ oldTag: string, newTag: string }`
- `POST /api/settings/telegram/test` - 发送 Telegram 测试通知
  - 请求体: `{ botToken: string, chatId: string }`

## 密码与会话

- `GET /api/settings/password-enabled` - 检查是否启用了登录/密码
- `GET /api/settings/reset-password-cooldown` - 获取重置冷却时间
- `POST /api/settings/verify-password` - 验证密码 (已废弃，保留兼容性)
  - 请求体: `{ password: string }`
- `POST /api/settings/verify-admin-password` - 验证管理员密码
  - 请求体: `{ password: string }`
- `POST /api/settings/verify-visitor-password` - 验证访客密码
  - 请求体: `{ password: string }`
- `POST /api/settings/reset-password` - 重置密码为随机值 (打印在后端日志中)
  - 请求体: 无
- `POST /api/settings/logout` - 清除认证 Cookie

## 通行密钥 (Passkeys)

- `GET /api/settings/passkeys` - 获取通行密钥列表 (仅安全字段)
- `GET /api/settings/passkeys/exists` - 检查是否存在通行密钥
- `POST /api/settings/passkeys/register` - 生成通行密钥注册选项
  - 请求体: `{ userName?: string }`
- `POST /api/settings/passkeys/register/verify` - 验证通行密钥注册
  - 请求体: `{ body: object, challenge: string }`
- `POST /api/settings/passkeys/authenticate` - 生成通行密钥认证选项
- `POST /api/settings/passkeys/authenticate/verify` - 验证通行密钥认证并签发认证 Cookie
  - 请求体: `{ body: object, challenge: string }`
- `DELETE /api/settings/passkeys` - 移除所有通行密钥

## Cookies

- `POST /api/settings/upload-cookies` - 上传 yt-dlp 使用的 cookie 文件
  - 多部分表单数据: `file`
- `POST /api/settings/delete-cookies` - 删除 cookie 文件
- `GET /api/settings/check-cookies` - 检查 cookie 文件是否存在

## 钩子 (Hooks)

- `GET /api/settings/hooks/status` - 获取钩子安装状态
- `POST /api/settings/hooks/:name` - 上传钩子脚本
  - 多部分表单数据: `file`
  - 有效的 `:name`: `task_before_start`, `task_success`, `task_fail`, `task_cancel`
- `DELETE /api/settings/hooks/:name` - 删除钩子脚本

## 数据库备份

- `GET /api/settings/export-database` - 下载当前数据库备份文件
- `POST /api/settings/import-database` - 导入 `.db` 备份文件并覆盖当前数据库
  - 多部分表单数据: `file`
- `GET /api/settings/last-backup-info` - 获取最新备份元数据
- `POST /api/settings/restore-from-last-backup` - 从最新备份恢复
- `POST /api/settings/cleanup-backup-databases` - 清理备份数据库文件

## 文件维护

- `POST /api/scan-files` - 扫描本地上传视频目录并与数据库同步
- `POST /api/scan-mount-directories` - 扫描配置的挂载目录并与数据库同步
  - 请求体: `{ directories: string[] }` (非空)
- `POST /api/cleanup-temp-files` - 移除临时下载文件 (`.part`, `.ytdl`, `temp_*`)

## 云存储

- `GET /api/cloud/signed-url` - 获取云签名 URL (或缓存的缩略图 URL)
  - 查询参数: `filename` (必需), `type` (可选: `video` 或 `thumbnail`)
- `POST /api/cloud/sync` - 双向同步本地/云端视频
  - 响应为流式 JSON 行进度事件
- `DELETE /api/cloud/thumbnail-cache` - 清除本地云缩略图缓存
- `GET /api/cloud/thumbnail-cache/:filename` - 提供缓存的云缩略图文件 (静态路由)

## 系统

- `GET /api/system/version` - 获取版本/更新信息
  - 返回: `{ currentVersion, latestVersion, releaseUrl, hasUpdate, ... }`

## 非 API 路由 (不在 `/api` 下)

- `GET /cloud/videos/:filename` - 重定向到签名云视频 URL
- `GET /cloud/images/:filename` - 提供缓存的云图像或重定向到签名图像 URL
- `GET /videos/*` - 静态本地视频
- `GET /images/*` - 静态本地缩略图/图像
- `GET /subtitles/*` - 静态字幕文件
- `GET /avatars/*` - 静态头像文件
