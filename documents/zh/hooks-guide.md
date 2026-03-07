# 任务钩子使用指南

MyTube 现在支持声明式任务钩子。  
钩子配置使用 JSON 动作定义，不再执行 Shell 脚本。

## 可用事件

| 钩子名称 | 触发时机 | 说明 |
| :--- | :--- | :--- |
| `task_before_start` | 下载开始前 | 在下载启动前执行。 |
| `task_success` | 下载成功后 | 下载/合并完成后执行，且在云上传/删除前执行。 |
| `task_fail` | 任务失败时 | 下载失败时执行。 |
| `task_cancel` | 任务取消时 | 任务被取消时执行。 |

钩子定义文件存放在 `backend/data/hooks/*.json`。

## 执行模型

- 事件 -> 队列 -> 受限执行器
- 钩子按顺序串行执行
- 不支持任意 Shell 命令

## 执行模式

- `HOOK_EXECUTION_MODE=inline`：
  - 由 backend 进程入队并在本地执行钩子动作。
  - 适合本地开发或单进程部署。
- `HOOK_EXECUTION_MODE=worker`：
  - backend 仅负责写入 `hook_worker_jobs` 队列。
  - 独立 `hook-worker` 进程/容器轮询并执行动作。
  - 推荐用于生产隔离。

worker 模式建议启用容器加固：
- 非 root 用户
- 只读根文件系统 + 独立可写数据挂载
- `no-new-privileges`
- `cap_drop: [ALL]`
- 启用 Docker 默认 seccomp 策略与 `apparmor=docker-default`

## 支持的动作类型

### `notify_webhook`

用于发送 HTTP Webhook 请求：

```json
{
  "version": 1,
  "actions": [
    {
      "type": "notify_webhook",
      "url": "https://example.com/mytube-hook",
      "method": "POST",
      "timeoutMs": 5000,
      "headers": {
        "X-App": "MyTube"
      },
      "bodyTemplate": "任务 {{taskTitle}} ({{taskId}}) -> {{status}}"
    }
  ]
}
```

`method` 仅支持：`POST`、`PUT`、`PATCH`。

## 模板变量

`bodyTemplate` 支持以下变量：

- `{{eventName}}`
- `{{taskId}}`
- `{{taskTitle}}`
- `{{sourceUrl}}`
- `{{status}}`
- `{{videoPath}}`
- `{{thumbnailPath}}`
- `{{error}}`

如果未提供 `bodyTemplate`，系统会发送包含上述字段的 JSON 请求体。

## 配置步骤

1. 打开 **设置**。
2. 进入 **高级设置**。
3. 找到 **任务钩子**。
4. 为对应事件上传 `.json` 钩子定义。
5. 需要时可删除并重新上传。

## 说明

- 旧版 `.sh` 钩子脚本将被执行器忽略。
- 上传的定义若包含无效或不支持的动作，会被拒绝。
