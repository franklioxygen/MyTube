# 管理员信任等级三档方案 – 设计文档

本文档描述 MyTube 的三档管理员信任模型，用于把当前“隐式信任边界”改为“由部署显式声明、由后端统一执行”的安全模型。

## 概览

建议新增一个部署级环境变量：

```env
MYTUBE_ADMIN_TRUST_LEVEL=application|container|host
```

建议默认值：

- `container`

默认选择 `container` 的原因：

- 与当前行为最接近。
- 现有实现下，管理员实际上已经接近拥有后端/容器进程级能力，例如 task hooks 和原始 yt-dlp 配置。
- 如果默认改成 `application`，会造成明显的行为破坏。

该配置必须满足：

- 属于部署级配置，而不是用户级配置。
- Web UI 中只读，不允许管理员自行修改。
- 来自环境变量，不落库。

## 目标

- 明确管理员的信任边界。
- 让 Docker / Compose 部署者可以显式声明本实例的安全模型。
- 基于该模型对高风险功能做统一门禁。
- 让管理员能在 UI 中清楚看到当前实例使用的是哪一档。
- 以默认兼容现有行为的方式落地。

## 非目标

- 该功能不保证 Docker 隔离本身的安全性。
- 该功能不会消除容器对已有 bind mount 的正常影响。
- 该功能不打算一次性把所有高风险功能都改造成沙箱。

## 三档定义

### 1. `application`

含义：

- 管理员仅被视为“应用层受信任操作者”。
- 不被视为 shell 操作者、容器操作者或宿主机操作者。

边界预期：

- 可以管理视频、合集、设置、密码、备份等正常应用功能。
- 不应通过 MyTube 主动获得 shell 命令执行能力。
- 不应通过 MyTube 主动操作超出应用标准存储目录模型之外的任意宿主路径。

直接含义：

- 任何隐含命令执行或任意文件系统遍历能力的功能，都需要关闭。

### 2. `container`

含义：

- 管理员被视为 MyTube 后端进程及其容器环境的受信任操作者。

边界预期：

- 可以使用以 MyTube backend 自身权限执行的功能。
- 但不应被直接视为“宿主机级操作者”。

重要说明：

- 如果 Docker 部署给容器挂载了 `/app/data`、`/app/uploads` 之类目录，那么容器级操作自然会影响这些挂载到宿主机的路径。这属于部署本身授予的能力。
- `container` 与 `host` 的区别，不在于“完全隔离宿主机”，而在于 MyTube 是否主动暴露“面向任意宿主机路径”的能力。

### 3. `host`

含义：

- 管理员被视为该部署的宿主机级受信任操作者。

边界预期：

- 可以使用会明确作用于任意绝对路径、或超出应用自有数据目录范围的宿主机级功能。
- 仅适用于部署者明确接受这一安全边界的场景。

## 为什么不用应用设置

这个配置不应存入普通 settings，原因很简单：

- 应用设置本身就是管理员可写的。
- 如果把“管理员受不受限制”也做成管理员可改，就失去安全意义。
- 信任边界是部署属性，不是用户偏好。

因此建议：

- 唯一真实来源：环境变量。
- 后端解析后以只读元数据形式暴露给前端。

## 后端设计

### 1. 新增安全模型配置模块

新增一个专门模块负责：

- 读取 `MYTUBE_ADMIN_TRUST_LEVEL`
- 只接受 `application`、`container`、`host`
- 缺失或非法值时回退到 `container`
- 非法值写 warning 日志

建议导出结构：

```ts
export type AdminTrustLevel = "application" | "container" | "host";

export interface DeploymentSecurityModel {
  adminTrustLevel: AdminTrustLevel;
  adminTrustedWithContainer: boolean;
  adminTrustedWithHost: boolean;
}
```

派生规则：

- `application` => container `false`，host `false`
- `container` => container `true`，host `false`
- `host` => container `true`，host `true`

### 2. 只读 API 暴露

建议通过只读字段把该模型返回给前端。

推荐挂载位置：

- `GET /api/settings`

建议返回结构：

```json
{
  "deploymentSecurity": {
    "adminTrustLevel": "container",
    "adminTrustedWithContainer": true,
    "adminTrustedWithHost": false,
    "source": "env"
  }
}
```

放在 `/api/settings` 的原因：

- 前端本来就在读取这个接口。
- 这个信息最适合出现在设置页。
- 不需要额外增加启动阶段请求。

## 前端设计

### 1. 只读展示

在 Settings 页的 Security 或 Advanced 区域增加一块只读说明，展示当前管理员信任等级。

UI 预期：

- 只读 badge 或摘要行。
- 一句简短解释，说明这一档意味着什么。
- 在 `container` / `host` 下可选增加提示条。

建议文案：

- `application`: 管理员仅被信任为应用层操作者。
- `container`: 管理员被信任可执行后端/容器进程级动作。
- `host`: 管理员被信任可执行宿主机范围动作。

### 2. 功能显隐

前端应根据当前等级隐藏或禁用不可用的功能。

但要强调：

- 前端显隐只是体验优化。
- 真正的安全控制必须由后端执行。

## 功能门禁矩阵

只有让该模型真正改变行为，它才有意义。

首版建议门禁如下：

| 能力 / 功能 | application | container | host |
| --- | --- | --- | --- |
| 常规应用管理（视频、合集、标签、登录、备份） | 允许 | 允许 | 允许 |
| Task Hooks 上传 / 删除 / 执行 | 禁用 | 允许 | 允许 |
| 原始 yt-dlp 配置文本框 | 禁用 | 允许 | 允许 |
| 完整原始 yt-dlp 参数透传 | 禁用 | 允许 | 允许 |
| mountDirectories 设置持久化 | 禁用 | 禁用 | 允许 |
| `POST /api/scan-mount-directories` | 禁用 | 禁用 | 允许 |
| 未来新增宿主机路径维护类功能 | 禁用 | 禁用 | 允许 |

## 按风险域划分的执行规则

### 1. Task Hooks

当前风险：

- hooks 通过 `bash` 以 backend 权限执行。

策略：

- `application`: 禁用
- `container`: 允许
- `host`: 允许

建议门禁点：

- Hook 上传路由
- Hook 删除路由
- Hook 执行路径再做一层防御

原因：

- hooks 本质就是命令执行，不应出现在 application-only 模型中。

### 2. 原始 yt-dlp 配置

当前风险：

- 该配置是自由文本，后端会解析并转成 yt-dlp CLI 参数。
- yt-dlp 官方支持 `--exec`、`--netrc-cmd`、插件目录、配置目录等高风险选项。

策略：

- `application`: 完全禁用原始 yt-dlp 配置文本框
- `container`: 保持当前行为
- `host`: 保持当前行为

原因：

- 对自由文本配置做 denylist 风险太高。
- 如果 `application` 代表“管理员不应获得命令执行能力”，那么原始配置编辑器本身就不应该存在。

未来增强：

- 后续可以为 `application` 增加“结构化、安全白名单”的 yt-dlp 选项界面，但不作为首版前提。

### 3. 挂载目录扫描

当前风险：

- 该功能会明确扫描应用默认视频目录之外的任意绝对路径。

策略：

- `application`: 禁用
- `container`: 禁用
- `host`: 允许

原因：

- 这是当前最典型的“宿主机范围功能”。
- 只有在部署者明确声明 `host` 时才应开放。

## API 与校验行为

### 1. 被策略禁止时的返回

当某个功能因为当前 trust level 被禁止时，后端应返回：

- `403 Forbidden`

建议错误结构：

```json
{
  "success": false,
  "error": "This feature is disabled by deployment security policy.",
  "requiredTrustLevel": "container"
}
```

对于宿主机级功能，也可以返回：

```json
{
  "success": false,
  "error": "This feature requires host-level admin trust.",
  "requiredTrustLevel": "host"
}
```

### 2. 对高风险 settings 写入的处理

对于被当前级别禁止的设置字段：

- 不应默默保存。

建议策略：

- 显式写入被禁止字段时，返回 `403`
- 不做 silent persist

例如：

- `application` 下拒绝保存 `ytDlpConfig`
- `application` 和 `container` 下拒绝保存 `mountDirectories`

## Docker Compose 示例

### 仅应用层管理员

```yaml
environment:
  - PORT=5551
  - MYTUBE_ADMIN_TRUST_LEVEL=application
```

### 容器级受信任管理员

```yaml
environment:
  - PORT=5551
  - MYTUBE_ADMIN_TRUST_LEVEL=container
```

### 宿主机级受信任管理员

```yaml
environment:
  - PORT=5551
  - MYTUBE_ADMIN_TRUST_LEVEL=host
```

## 迁移与兼容性

迁移要求：

- 不需要数据库迁移
- 不需要 settings schema 迁移

兼容策略：

- 环境变量缺失时默认为 `container`
- 现有部署不需要做任何改动，也不会突然失去当前行为

显式切换后的语义：

- `application`：有意关闭当前高风险管理员功能
- `host`：有意开放超出 `container` 模型的宿主机范围能力

## 测试计划

### 后端测试

- 缺失 env 时解析为 `container`
- 非法 env 值时 warning + 回退
- `application` 下 hook 路由返回 `403`
- `application` 下不会进入 hook 执行逻辑
- `host` 之外拒绝 mount directory 相关路由和设置写入
- `application` 下拒绝原始 yt-dlp 配置写入
- `GET /api/settings` 返回 `deploymentSecurity`

### 前端测试

- 设置页能正确展示 trust level
- `application` 下隐藏或禁用 hooks UI
- `application` 下隐藏或禁用原始 yt-dlp 配置 UI
- 只有 `host` 下显示 mount directory 相关 UI

## 分阶段落地建议

### Phase 1

- 新增 env 解析
- 新增只读 API 暴露
- 设置页展示当前 trust level

### Phase 2

- 后端为 hooks、原始 yt-dlp 配置、mount directory 功能加门禁
- 前端同步做显隐

### Phase 3

- 更新用户文档与 Docker 部署示例
- 如有需要，在安全文档中补充明确表述

## 未决问题

- `container` 是否长期保留为默认值，还是未来大版本再切到 `application`
- `application` 下原始 yt-dlp 配置是永久禁用，还是后续换成结构化白名单功能
- 后续是否还会引入更多 `host` 档专属功能

## 推荐决策

首版建议：

- 采用三档模型
- 默认 `container`
- 把 hooks 和原始 yt-dlp 配置归为 `container` 功能
- 把 mount directory 扫描归为 `host` 功能
- 信任等级只做部署级、只读配置，不进入普通 settings

这样以后就能更明确地回答安全问题：

- `application`: 管理员不被视为拥有 shell / container / host 级执行能力
- `container`: 管理员被视为拥有后端 / 容器进程级能力
- `host`: 管理员被视为拥有宿主机范围管理能力

_设计文档结束。在明确批准前，不开始实现。_
