# 部署安全模型

本文档说明 MyTube 中管理员的三档部署安全模型。

当前生效的模式通过下面的环境变量配置：

```env
MYTUBE_ADMIN_TRUST_LEVEL=application|container|host
```

如果该变量缺失或取值非法，MyTube 会回退到：

```env
MYTUBE_ADMIN_TRUST_LEVEL=container
```

## 为什么需要这个配置

有些管理员功能只属于常规应用管理，有些则会进一步触及后端进程、容器能力，甚至宿主机路径范围。

这套部署安全模型的目的，就是把这条边界明确下来：

- `application`：管理员只被信任为应用层操作者，不被信任为后端/容器级操作者
- `container`：管理员被信任可执行后端/容器进程级动作
- `host`：管理员被信任可执行宿主机范围动作

这是部署决策，不是用户偏好。后端会从环境变量读取该配置，并以只读信息暴露给前端显示。

## 如何选择

### `application`

适合这些场景：

- 你希望管理员只做常规 MyTube 管理
- 你不希望管理员上传或执行 shell 类型 hooks
- 你不希望管理员使用原始 yt-dlp 参数透传能力
- 你不希望管理员操作宿主机范围的挂载目录功能

这是限制最强的一档。

如果你的目标是“admin 只停留在应用层”，就选它。

### `container`

适合这些场景：

- 你信任管理员使用后端/容器进程级功能
- 你希望 task hooks 和原始 yt-dlp 配置可用
- 你不希望开放宿主机范围的挂载目录功能

这是默认值，因为它最接近 MyTube 的现有行为。

### `host`

适合这些场景：

- 你明确把管理员视为部署操作者
- 你希望开放挂载目录设置和挂载目录扫描
- 你接受宿主机范围维护功能属于当前信任边界

只有部署者明确接受这条边界时才应使用这一档。

## 功能矩阵

| 能力 / 功能 | application | container | host |
| --- | --- | --- | --- |
| 常规应用管理（视频、合集、标签、登录、备份） | 是 | 是 | 是 |
| Task hooks 上传 / 删除 / 执行 | 否 | 是 | 是 |
| 原始 yt-dlp 配置文本框 | 否 | 是 | 是 |
| 完整原始 yt-dlp 参数透传 | 否 | 是 | 是 |
| 挂载目录设置持久化 | 否 | 否 | 是 |
| 扫描已配置挂载目录中的文件 | 否 | 否 | 是 |
| 未来宿主机路径维护类功能 | 否 | 否 | 是 |

## 各档实际效果

### Application 模式

管理员仍然可以：

- 管理视频、合集、标签、备份、用户和常规设置
- 使用不依赖原始透传能力的正常下载流程

管理员不能：

- 上传、删除或执行 task hook 脚本
- 使用原始 yt-dlp 配置文本框
- 保存或扫描挂载目录

### Container 模式

管理员还可以额外：

- 上传、删除和执行 task hooks
- 使用原始 yt-dlp 配置和原始参数透传

管理员仍然不能：

- 使用宿主机范围的挂载目录管理功能

重要说明：

- 在 Docker 部署中，如果容器通过 bind mount 挂载了 `/app/data`、`/app/uploads` 等路径，那么容器级动作天然会影响这些宿主机挂载路径
- 这属于部署本身授予的能力，不代表 MyTube 在该模式下把管理员视为宿主机级操作者

### Host 模式

管理员还可以额外：

- 保存挂载目录设置
- 扫描已配置挂载目录中的文件
- 使用未来可能加入的宿主机路径维护类功能

## 配置示例

### Docker Compose

```yaml
environment:
  - MYTUBE_ADMIN_TRUST_LEVEL=application
```

```yaml
environment:
  - MYTUBE_ADMIN_TRUST_LEVEL=container
```

```yaml
environment:
  - MYTUBE_ADMIN_TRUST_LEVEL=host
```

升级权限说明：

- 从 `v1.9.0` 开始，后端容器默认以非 root 的 `node` 用户运行（`uid/gid 1000`）
- 如果你升级的是 `v1.9.0` 之前创建的 bind mount 部署，需要确保宿主机上的 `uploads` 和 `data` 挂载目录对 `uid/gid 1000` 可写
- 这同样适用于已有子目录，例如 `uploads/images-small`；如果它仍然归 `root` 所有，缩略图生成或扫描可能会因 `EACCES` 失败

宿主机上的修复示例：

```bash
chown -R 1000:1000 /path/to/mytube/uploads /path/to/mytube/data
```

### 直接运行源码

```bash
MYTUBE_ADMIN_TRUST_LEVEL=application npm run dev
```

```bash
export MYTUBE_ADMIN_TRUST_LEVEL=host
npm run dev
```

也可以直接写入 `backend/.env`。

## UI 表现

设置页会以只读方式显示当前部署安全模型。

前端也会根据当前档位隐藏或禁用不允许使用的功能，但真正的安全门禁仍由后端执行。即使客户端直接尝试调用受限 API，后端也会拒绝。

## 建议

一般建议：

- 如果管理员只应停留在应用层，使用 `application`
- 如果管理员需要 hooks 或原始 yt-dlp 透传能力，使用 `container`
- 只有在管理员应被视为宿主机范围部署操作者时，才使用 `host`

如果你不确定怎么选，优先考虑是否真的需要 hooks、原始 yt-dlp 配置或挂载目录能力。没有这些需求时，更适合使用 `application`。
