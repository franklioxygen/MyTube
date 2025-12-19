# API 端点

## 视频下载与搜索
- `GET /api/search` - 在线搜索视频 (YouTube)
  - 查询参数: `query` (必需), `limit` (可选, 默认: 8), `offset` (可选, 默认: 1)
- `POST /api/download` - 从支持的平台下载视频
  - 请求体: `{ url: string, ...options }`
  - 支持: YouTube, Bilibili, MissAV 以及所有 yt-dlp 支持的网站
- `GET /api/check-video-download` - 检查视频是否已下载
  - 查询参数: `url` (必需)
  - 返回: `{ found: boolean, status: 'exists' | 'deleted', videoId?: string, ... }`
- `GET /api/check-bilibili-parts` - 检查 Bilibili 视频是否包含多个分P
  - 查询参数: `url` (必需)
- `GET /api/check-bilibili-collection` - 检查 Bilibili URL 是否为合集/系列
  - 查询参数: `url` (必需)
- `GET /api/download-status` - 获取当前下载状态
  - 返回: `{ active: [], queued: [] }`

## 视频管理
- `POST /api/upload` - 上传本地视频文件
  - 多部分表单数据: `video` (文件)
  - 自动生成缩略图
- `GET /api/videos` - 获取所有已下载的视频
  - 查询参数: `page` (可选), `limit` (可选), `sortBy` (可选), `order` (可选), `search` (可选), `author` (可选), `tags` (可选)
- `GET /api/videos/:id` - 通过 ID 获取特定视频
- `PUT /api/videos/:id` - 更新视频详情
  - 请求体: `{ title?, author?, tags?, rating?, ... }`
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
  - 首先检查数据库，如果未找到则从 YouTube/Bilibili API 获取

## 下载管理
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
- `DELETE /api/subscriptions/:id` - 删除订阅

## 设置与系统
- `GET /api/settings` - 获取应用设置
- `POST /api/settings` - 更新应用设置
  - 请求体: `{ [key: string]: any }` - 设置对象
  - 支持: `visitorMode`, `cloudDriveEnabled`, `openListApiUrl`, `openListToken`, `openListPublicUrl`, `cloudDrivePath` 等设置
- `GET /api/settings/password-enabled` - 检查是否启用了密码保护
- `POST /api/settings/verify-password` - 验证登录密码
  - 请求体: `{ password: string }`
- `POST /api/settings/reset-password` - 重置登录密码
  - 请求体: `{ oldPassword: string, newPassword: string }`
- `POST /api/settings/migrate` - 从 JSON 迁移数据到 SQLite
- `POST /api/settings/delete-legacy` - 删除旧的 JSON 数据文件
- `POST /api/settings/format-filenames` - 根据设置格式化视频文件名
- `POST /api/settings/upload-cookies` - 上传 cookies.txt 以供 yt-dlp 使用
  - 多部分表单数据: `file` (cookies.txt)
- `POST /api/settings/delete-cookies` - 删除 cookies.txt
- `GET /api/settings/check-cookies` - 检查 cookies.txt 是否存在
- `GET /api/settings/export-database` - 导出数据库作为备份文件
- `POST /api/settings/import-database` - 从备份文件导入数据库
  - 多部分表单数据: `file` (数据库备份文件)
- `GET /api/settings/last-backup-info` - 获取最后一个数据库备份的信息
- `POST /api/settings/restore-from-last-backup` - 从最后一个备份恢复数据库
- `POST /api/settings/cleanup-backup-databases` - 清理旧的备份数据库文件

## 文件管理
- `POST /api/scan-files` - 扫描上传目录中的现有视频文件
- `POST /api/cleanup-temp-files` - 清理临时下载文件

## 云存储
- `GET /cloud/videos/:filename` - 代理端点，用于从云存储（OpenList/Alist）流式传输视频
- `GET /cloud/images/:filename` - 代理端点，用于从云存储（OpenList/Alist）提供图像
  - 注意：这些端点需要在设置中配置云存储
