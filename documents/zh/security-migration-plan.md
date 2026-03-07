# 安全迁移计划（3 阶段）

本文定义 strict 安全模型的发布节奏。以下日期为目标窗口，可由发布负责人按实际情况微调。

## 时间线

- 阶段 1（`vNext`）：2026-04-15
- 阶段 2（`vNext+1`）：2026-05-20
- 阶段 3（`vNext+2`）：2026-06-24

## 阶段 1（`vNext`）- 先可见、再兼容

目标：
- 上线 strict 底座与迁移可观测能力，避免对升级实例立即硬破。

默认行为：
- 新安装默认 `SECURITY_MODEL=strict`。
- 升级实例在迁移窗口内可临时使用 `SECURITY_MODEL=legacy`。

实施项：
- 在生产环境对 `SECURITY_MODEL` 执行 fail-closed 启动校验。
- 提供迁移扫描工具与报告输出：
  - `npm --prefix backend run security-migration:scan -- --format markdown --out data/security-migration-report.md`
- 对高风险控制面访问输出审计与告警信号。

阶段退出条件：
- 每个升级实例都有扫描报告和责任人。
- 高风险项都有整改计划和截止时间。
- 无大面积认证/下载回归。

## 阶段 2（`vNext+1`）- 默认安全

目标：
- 升级实例默认切换到 strict。

默认行为：
- 升级实例默认 strict。
- `legacy` 必须显式开启，且仅限短期、可审计用途。

实施项：
- 未认证写接口默认拒绝。
- bootstrap 保持一次性 + 并发原子。
- strict 下持续禁用：
  - hooks shell 执行
  - `ytDlpConfig` 自由文本透传
  - `mountDirectories` API 写入

阶段退出条件：
- 大多数实例在 strict 下稳定运行。
- legacy 使用率降到可控低位，且可追踪责任人。

## 阶段 3（`vNext+2`）- 移除 legacy

目标：
- 移除 legacy，完成安全边界定型。

默认行为：
- 仅支持 `SECURITY_MODEL=strict`。

实施项：
- 删除 legacy 代码/配置/文档分支。
- 仅保留声明式 hooks 与 allowlist 安全配置。
- 清理 legacy 兼容 API 和前端入口。

阶段退出条件：
- 代码中不存在 legacy 分支。
- 安全测试与 CI 闸门全部通过。
- 发布说明明确列出 breaking 变更与替代方案。

## 分阶段回滚策略

- `vNext`：允许版本级回滚；允许短期 `legacy`（需审计）。
- `vNext+1`：仅允许短时 `legacy` 回退，必须绑定到期时间与工单。
- `vNext+2`：仅允许版本级回滚，不再支持运行时切回 `legacy`。
