# 安全 Breaking 变更矩阵

本文是安全模型迁移的对外契约，所有客户端与集成方应以此为准。

## 错误语义

- `401`：未认证（缺失/无效会话）
- `403`：已认证但无权限，或 strict 策略下能力被禁用
- `409`：冲突（例如 bootstrap 已完成）

## API 与配置变更

| 变更项 | 旧行为 | 新行为 | 生效阶段 | 替代方案 |
| --- | --- | --- | --- | --- |
| 未认证写接口 | `loginEnabled=false` 时可能放行 | 默认拒绝（`401`/`403`） | `vNext+1` 默认，`vNext+2` 强制 | 先完成管理员认证 |
| `passkeys/register` | legacy 下可能公开或弱保护 | 仅管理员可调用 | `vNext+1` | 登录后通过管理员会话调用 |
| `reset-password` | 公开路径可触达 | 仅管理员会话或一次性恢复 token | `vNext+1` | 受控恢复 token 流程 |
| hooks shell 执行 | 可执行用户脚本/命令 | 禁用 shell 执行 | `vNext+1` 默认，`vNext+2` 强制 | 声明式动作（`notify_webhook`） |
| `ytDlpConfig` 自由文本 | 任意文本透传 | 仅结构化 allowlist | `vNext+1` 默认，`vNext+2` 强制 | `ytDlpSafeConfig` 字段 |
| `mountDirectories` API 写入 | 可写任意宿主绝对路径 | 禁止 API 写入，改平台白名单 | `vNext+1` 默认，`vNext+2` 强制 | `PLATFORM_MOUNT_DIRECTORIES` |
| 应用内 cloudflared 控制 | App Admin 可直接控制进程 | strict 下禁用控制面 | `vNext+1` | 平台侧托管 tunnel 生命周期 |

## 客户端改造示例

## 示例 1：重置密码

旧流程：
- 直接调用公开 `POST /api/settings/reset-password`。

新流程：
1. 管理员先认证登录。
2. 管理员调用 `POST /api/settings/reset-password/recovery-token` 获取一次性 token。
3. 使用 token 调用 `POST /api/settings/reset-password`。

## 示例 2：任务 Hook

旧流程：
- 上传 `.sh` 并依赖 shell 执行。

新流程：
1. 上传 JSON hook 定义。
2. 仅使用声明式动作类型。
3. 生产环境建议 `HOOK_EXECUTION_MODE=worker`。

## 示例 3：挂载目录

旧流程：
- 通过 settings API 直接保存宿主绝对路径。

新流程：
1. 平台侧配置 `PLATFORM_MOUNT_DIRECTORIES`。
2. App Admin 仅选择目录 ID。

## 回滚与兼容窗口

- `vNext` 到 `vNext+1` 限定窗口内，可临时设置 `SECURITY_MODEL=legacy`，但必须保留审计记录。
- `vNext+2` 起不再支持运行时切回 `legacy`。
- 出现阻断回归时采用版本级回滚。

## 最低迁移版本要求

- 迁移扫描报告应满足：
  - `strictSecurityMigrationVersion >= 1`
  - `ytDlpSafeConfigMigrationVersion >= 1`

