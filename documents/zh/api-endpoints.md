# API 端点

## 视频
- `POST /api/download` - 下载视频 (YouTube 或 Bilibili)
- `POST /api/upload` - 上传本地视频文件
- `GET /api/videos` - 获取所有已下载的视频
- `GET /api/videos/:id` - 获取特定视频
- `PUT /api/videos/:id` - 更新视频详情
- `DELETE /api/videos/:id` - 删除视频
- `GET /api/videos/:id/comments` - 获取视频评论
- `POST /api/videos/:id/rate` - 评价视频
- `POST /api/videos/:id/refresh-thumbnail` - 刷新视频缩略图
- `POST /api/videos/:id/view` - 增加观看次数
- `PUT /api/videos/:id/progress` - 更新播放进度
- `GET /api/search` - 在线搜索视频
- `GET /api/download-status` - 获取当前下载状态
- `GET /api/check-bilibili-parts` - 检查 Bilibili 视频是否包含多个分P
- `GET /api/check-bilibili-collection` - 检查 Bilibili URL 是否为合集/系列
- `GET /api/check-video-download` - 检查视频是否已下载 (通过 URL)

## 下载管理
- `POST /api/downloads/cancel/:id` - 取消下载
- `DELETE /api/downloads/queue/:id` - 从队列中移除
- `DELETE /api/downloads/queue` - 清空队列
- `GET /api/downloads/history` - 获取下载历史
- `DELETE /api/downloads/history/:id` - 从历史中移除
- `DELETE /api/downloads/history` - 清空历史

## 收藏夹
- `GET /api/collections` - 获取所有收藏夹
- `POST /api/collections` - 创建新收藏夹
- `PUT /api/collections/:id` - 更新收藏夹 (添加/移除视频)
- `DELETE /api/collections/:id` - 删除收藏夹

## 订阅
- `GET /api/subscriptions` - 获取所有订阅
- `POST /api/subscriptions` - 创建新订阅
- `DELETE /api/subscriptions/:id` - 删除订阅

## 设置与系统
- `GET /api/settings` - 获取应用设置
- `POST /api/settings` - 更新应用设置
- `POST /api/settings/verify-password` - 验证登录密码
- `POST /api/settings/migrate` - 从 JSON 迁移数据到 SQLite
- `POST /api/settings/delete-legacy` - 删除旧的 JSON 数据
- `POST /api/scan-files` - 扫描现有文件
- `POST /api/cleanup-temp-files` - 清理临时下载文件
- `GET /api/settings/password-enabled` - 检查是否启用了密码保护
- `POST /api/settings/upload-cookies` - 上传 cookies.txt 以供 yt-dlp 使用
- `POST /api/settings/delete-cookies` - 删除 cookies.txt
- `GET /api/settings/check-cookies` - 检查 cookies.txt 是否存在
