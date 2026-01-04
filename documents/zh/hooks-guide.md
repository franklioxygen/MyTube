# 任务钩子使用指南 (Task Hooks Guide)

MyTube 允许您在下载任务的不同阶段执行自定义 Shell 脚本，用于后处理、通知或外部集成。

## 可用钩子 (Available Hooks)

| 钩子名称 | 触发时机 | 描述 |
| :--- | :--- | :--- |
| **任务开始前** (`task_before_start`) | 下载开始前 | 在下载开始前立即执行。 |
| **任务成功** (`task_success`) | 下载成功后 | 下载/合并完成后执行，且在云存储上传（若启用）或删除之前执行。 |
| **任务失败** (`task_fail`) | 任务失败时 | 下载失败时执行。 |
| **任务取消** (`task_cancel`) | 任务取消时 | 用户取消正在运行的任务时执行。 |

默认脚本目录为 `backend/data/hooks`。

## 环境变量 (Environment Variables)

| 变量 | 描述 | 示例 |
| :--- | :--- | :--- |
| `MYTUBE_TASK_ID` | 任务唯一标识 | `335e98f0-15cb-46a4-846d-9d4351368923` |
| `MYTUBE_TASK_TITLE` | 视频/任务标题 | `Awesome Video Title` |
| `MYTUBE_SOURCE_URL` | 视频原始 URL | `https://www.youtube.com/watch?v=...` |
| `MYTUBE_TASK_STATUS` | 当前状态 | `start`, `success`, `fail`, `cancel` |
| `MYTUBE_VIDEO_PATH` | 视频文件绝对路径 | `/app/uploads/videos/video.mp4` |
| `MYTUBE_THUMBNAIL_PATH` | 缩略图绝对路径 | `/app/uploads/images/video.jpg` |
| `MYTUBE_ERROR` | 错误消息（仅 `task_fail`） | `Network timeout` |

## 配置 (Configuration)

1. 进入 **设置 (Settings)**。
2. 打开 **高级设置 (Advanced Settings)**。
3. 找到 **任务钩子 (Task Hooks)**。
4. 上传对应事件的 `.sh` 脚本。
5. 需要时可删除或重新上传。

钩子脚本使用 `bash` 执行，上传后会自动赋予可执行权限。

## 查看日志 (Viewing Logs)

脚本输出 (stdout/stderr) 会被后端捕获并记录。
- 标准输出 (`echo "..."`) 记录为 `INFO`。
- 标准错误 (`>&2 echo "..."`) 记录为 `WARN`。

示例：
```bash
echo "Hook started for task $MYTUBE_TASK_ID"
```
在服务器日志中将显示为：
`[INFO] [HookService] task_success stdout: Hook started for task 123...`

## 示例 (Examples)

### 1. 简单日志记录
将每个成功的下载记录到自定义文件中。
**钩子:** `task_success`
```bash
#!/bin/bash
# 请提供日志文件的完整路径
echo "[$(date)] Downloaded: $MYTUBE_TASK_TITLE" >> /tmp/mytube_downloads.log
```

### 2. 发送通知 (例如 ntfy.sh)
当任务失败时发送通知。
**钩子:** `task_fail`
```bash
#!/bin/bash
curl -d "MyTube Download Failed: $MYTUBE_TASK_TITLE - $MYTUBE_ERROR" https://ntfy.sh/my_topic
```

### 3. 文件后处理
运行 Python 脚本处理文件。
**钩子:** `task_success`
```bash
#!/bin/bash
python3 /path/to/process_video.py "$MYTUBE_VIDEO_PATH"
```

## 安全警告 (Security Warning)

> [!WARNING]
> 钩子命令以与 MyTube 后端相同的权限执行。
> - 使用修改或删除文件的命令时请务必小心。
> - 请勿复制粘贴来自不可信来源的脚本。
> - 确保脚本能正确处理错误。
