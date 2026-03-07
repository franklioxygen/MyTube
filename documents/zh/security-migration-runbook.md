# 安全迁移 Runbook（单实例）

本 runbook 面向单实例执行，可用于测试环境和生产迁移，支持直接全量切换。

## 前置条件

- 具备部署环境操作权限。
- 可执行数据库备份。
- 可修改环境变量并重启后端服务。
- 可查看后端日志与安全审计日志。

## 步骤 1：迁移前快照

记录以下信息：
- 数据库备份文件 ID/校验值
- 当前 `backend/.env` 安全相关配置
- 当前版本号/镜像 tag

建议命令：

```bash
npm --prefix backend run security-migration:scan -- --format markdown --out data/security-migration-report-pre.md
```

## 步骤 2：执行 dry-run 迁移扫描

执行扫描并归档输出：

```bash
npm --prefix backend run security-migration:scan -- --format json --out data/security-migration-report-pre.json
```

如果存在 high-risk 项，不要切换 strict。

## 步骤 3：整改并复扫

常见整改项：
- 删除 legacy `.sh` hooks
- 清理自由文本 `ytDlpConfig`
- 将挂载目录迁移到 `PLATFORM_MOUNT_DIRECTORIES`
- 关闭应用内 cloudflared 控制

复扫命令：

```bash
npm --prefix backend run security-migration:scan -- --format json --out data/security-migration-report-post.json --assert-clean
```

`--assert-clean` 在存在 high-risk 项时返回非零退出码。

## 步骤 4：选择切换模式

统一设置：
- `SECURITY_MODEL=strict`
- 生产建议 `HOOK_EXECUTION_MODE=worker`
- `SECURITY_AUDIT_RETENTION_DAYS=90`
- `SECURITY_ALERT_WINDOW_RETENTION_DAYS=7`

模式 A（推荐）：先 canary 后全量
- 先切换小范围 canary
- 覆盖一个业务高峰观察窗口
- 稳定后再扩展全量

模式 B（运维豁免）：一次全量切换（不做 canary）
- 在一个变更窗口内一次切到全量 strict
- 执行前必须满足：
  - `--assert-clean` 扫描已通过
  - 回滚路径已准备（版本回滚或审批窗口内临时 legacy）
  - 操作人已确认并接受业务影响风险

## 步骤 5：切换后验证与归档

无论 canary 还是全量直切，均需：
- 验证管理员登录、下载、挂载扫描、播放、告警信号
- 验证密码恢复仅接受 `x-mytube-recovery-token` 请求头或 request body，query string token 会被拒绝
- 验证历史 API 调用方仍可读取废弃只读字段 `mountDirectories`，但不可再写入
- 归档最终产物：
  - pre/post 扫描报告
  - 变更摘要
  - 剩余风险清单
  - 决策记录（含“是否跳过 canary”及原因）

## 步骤 6：触发阈值后的回滚

回滚优先级：
- 优先版本级回滚
- 迁移窗口内可临时 `SECURITY_MODEL=legacy`

每次回滚必须记录：
- 触发原因
- 影响范围
- 恢复开始/结束时间
- 责任人及后续整改工单

## 幂等性要求

迁移扫描为只读，可重复执行：
- 重复 dry-run 不会修改系统状态
- 报告格式稳定，可归档、可比对
