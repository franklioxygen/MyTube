# 任务钩子使用指南 (Task Hooks Guide)

MyTube允许您在下载任务生命周期的不同阶段执行自定义Shell脚本。此功能对于与其他系统集成、对下载的文件进行后处理或发送通知非常有用。

## 可用钩子 (Available Hooks)

您可以为以下事件配置命令：

| 钩子名称 | 触发时机 | 描述 |
| :--- | :--- | :--- |
| **任务开始前** (`task_before_start`) | 下载开始前 | 在下载过程开始之前立即执行。适用于设置或验证。 |
| **任务成功** (`task_success`) | 下载成功后 | 在文件成功下载/合并后，但在上传到云存储（如果启用）或删除之前执行。这是文件处理的理想位置。 |
| **任务失败** (`task_fail`) | 任务失败时 | 如果下载因任何原因失败，则执行此钩子。 |
| **任务取消** (`task_cancel`) | 任务取消时 | 当用户手动取消正在运行的任务时执行。 |

## 环境变量 (Environment Variables)

当钩子命令执行时，以下环境变量将被注入到Shell环境，提供有关任务的上下文：

| 变量 | 描述 | 示例 |
| :--- | :--- | :--- |
| `MYTUBE_TASK_ID` | 任务的唯一标识符 | `335e98f0-15cb-46a4-846d-9d4351368923` |
| `MYTUBE_TASK_TITLE` | 视频/任务的标题 | `Awesome Video Title` |
| `MYTUBE_SOURCE_URL` | 视频的原始URL | `https://www.youtube.com/watch?v=...` |
| `MYTUBE_TASK_STATUS` | 任务的当前状态 | `success`, `fail`, `cancelled` |
| `MYTUBE_VIDEO_PATH` | 下载视频文件的绝对路径 | `/app/downloads/video.mp4` |
| `MYTUBE_THUMBNAIL_PATH` | 缩略图文件的绝对路径 | `/app/downloads/video.jpg` |
| `MYTUBE_ERROR` | 错误消息（仅限 `task_fail`） | `Network timeout` |

## 配置 (Configuration)

您可以在网页界面中配置钩子：
1. 转到 **设置 (Settings)**。
2. 向下滚动到 **高级设置 (Advanced Settings)**。
3. 找到 **任务钩子 (Task Hooks)** 部分。
4. 输入您想要为特定事件执行的Shell命令。
5. 点击 **保存 (Save)**。

## 示例 (Examples)

### 1. 简单日志记录
将每个成功的下载记录到文件中。
**钩子:** `task_success`
```bash
echo "[$(date)] Downloaded: $MYTUBE_TASK_TITLE" >> /path/to/mytube_downloads.log
```

### 2. 发送通知 (例如 ntfy.sh)
当任务失败时发送通知。
**钩子:** `task_fail`
```bash
curl -d "MyTube Download Failed: $MYTUBE_TASK_TITLE - $MYTUBE_ERROR" https://ntfy.sh/my_topic
```

### 3. 文件后处理
运行脚本处理文件（例如，移动文件或重新编码）。
**钩子:** `task_success`
```bash
/path/to/my_processing_script.sh "$MYTUBE_VIDEO_PATH"
```

## 安全警告 (Security Warning)

> [!WARNING]
> 钩子命令以与MyTube后端服务器相同的权限执行。
> - 使用修改或删除文件的命令时请务必小心。
> - 请勿复制粘贴来自不可信来源的脚本。
> - 确保您的脚本能够优雅地处理错误。
