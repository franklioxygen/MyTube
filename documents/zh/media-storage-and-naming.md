# 媒体存储与文件命名

本文说明 MyTube 如何决定**下载文件的存储位置**以及**文件名的生成方式**。当前模型是为修复媒体碰撞与排序问题（Issue #391）而引入的，并统一了所有写入磁盘的路径。

概览如下：

> 每个媒体项获得一个**稳定身份** `(platform, sourceVideoId, mediaType, part)` → 由 **legacy** 或 **template** 命名模式生成文件名 → 按**作者文件夹**物理结构放置 → **输出路径分配器**整体预留文件家族并在冲突时让位 → 通过**不覆盖、暂存 + 硬链接**的模型发布到最终路径，全程崩溃安全并支持回滚。

---

## 1. 存储目录结构

所有媒体位于 `backend/uploads/` 下，分为三个受管根目录：

| 类型 | 目录 | Web 路径前缀 |
|---|---|---|
| 视频 | `uploads/videos/` | `/videos/...` |
| 缩略图 | `uploads/images/` | `/images/...` |
| 字幕 | `uploads/subtitles/` | `/subtitles/...` |

- 缩略图和字幕可以选择**与视频放在同一文件夹**（通过"将缩略图/字幕移至视频文件夹"的设置）。启用后，它们会写入 `/videos/...` 而非各自的独立根目录。
- `images-small/` 保存内部的小图预览缓存，镜像完整尺寸缩略图的目录结构。
- `backend/data/` 保存支撑并发与崩溃恢复的内部状态：
  - `output-path-reservations/` — 路径预留锁文件（见 §4）
  - `output-family-journals/` — 用于崩溃恢复 / 回滚的发布日志（见 §5）
  - `.mytube-staging/` — 目标磁盘上的同盘暂存目录

根目录定义于 `backend/src/config/paths.ts`。

---

## 2. 稳定的媒体身份

每个下载项现在都带有一个 `MediaIdentity`：

```ts
{ platform, sourceVideoId, mediaType: "video" | "audio", partNumber?, localVideoId? }
```

- `videos` 表新增 `sourceVideoId` 列；新增 `video_downloads` 追踪表，以 **(sourceVideoId, platform, mediaType)** 为唯一键。其确定性 id 为 `platform:sourceVideoId`（音频再追加 `:mediaType`）。
- 对于**多 P**媒体，追踪行指向**编号最小的存活分 P**。删除某个分 P 会自动把追踪行移交给下一个分 P。
- 身份落库采用 **fail-closed**：URL 解析出的 source id、视频记录上的值、以及 identity 三者必须一致，否则抛错。

相关代码：`backend/src/services/storageService/downloadedMediaIdentity.ts`。

---

## 3. 文件命名

命名有两种模式（设置 `downloadFilenameMode`），在 `planVideoOutputPaths`（`backend/src/services/filenameTemplate/renderer.ts`）中分流。

### 3.1 legacy 模式

绕过模板渲染器，直接使用 `formatVideoFilename(title, author, date)` → `标题-作者-YYYY`（去除符号，空格转为点）。这样输出与旧文件字节一致，便于批量重命名识别"已在目标位置"的文件。在 legacy 与模板模式之间切换时，`stripLegacyFilenameSuffix` 会先剥离可识别的旧后缀，避免后缀被重复拼接。

### 3.2 template 模式（Liquid 模板）

由 Liquid 风格模板渲染相对路径。变量定义于 `backend/src/services/filenameTemplate/reference.ts`。关键变量：

| 变量 | 含义 | 示例 |
|---|---|---|
| `{{ title }}` | 标题 | `Sample Video` |
| `{{ source_video_id }}` | 来源平台视频 ID | `BV1AB411c7mD` |
| `{{ id }}` | **现在等同于 `source_video_id`**（不再是本地 id） | `dQw4w9WgXcQ` |
| `{{ local_video_id }}` | 本地库记录 id（含分 P） | `1785234567890_part2` |
| `{{ download_datetime }}` | 下载时刻（UTC） | `2026-07-28_14-03-52` |
| `{{ ext }}` | 扩展名 | `mp4` |
| `{{ uploader }}` / `{{ channel }}` / `{{ artist_name }}` | 作者 / 频道 | `Sample Channel` |
| `{{ upload_yyyy_mm_dd }}` / `{{ upload_date }}` / `{{ upload_year }}` … | 上传日期各部分 | `2026-04-30` |
| `{{ source_custom_name }}` / `{{ source_collection_name }}` … | 来源名 / 合集 | `Sample Channel` |
| `{{ season_* }}` / `{{ static_season__* }}` | 季/集辅助变量 | `Season 2026/s2026e0430` |
| `%(title)s`、`%(upload_date>%Y-%m-%d)s` … | 原生 yt-dlp 占位符 | — |

> **重要行为变化：** `{{ id }}` 现在映射到 **source-video-id**，因此文件名中嵌入的 id 是稳定的来源标识，能天然区分不同来源。

**内置预设**（`backend/src/services/filenameTemplate/presets.ts`）包含防碰撞的 `source_date_id`：

```
{{ source_custom_name }}/{{ upload_yyyy_mm_dd }} - {{ title }} [{{ source_video_id }}].{{ ext }}
```

把 `source_video_id` 放进文件名，可让来源不同的同名视频从一开始就相互区分。

### 3.3 作者文件夹组织

`applyPhysicalOrganization`（`backend/src/services/filenameTemplate/organizationPath.ts`）现在对 **legacy 和 template 两种模式统一生效**。当开启作者文件夹组织，且渲染出的路径首段不是作者名时，整条路径会被放到物理的 `作者名/...` 文件夹下。

---

## 4. 输出路径分配器（冲突处理）

所有最终写入都要经过 `allocateOutputFamilySync`（`backend/src/services/filenameTemplate/outputPathAllocator.ts`）。它把**整个"家族"**——视频 + 缩略图 + 字幕 stem——作为一个整体预留，因此语言尚未确定的字幕不会被其他行抢占。

冲突时后缀会**逐级升级**：

1. `none` — 首选路径空闲，直接使用。
2. `source_id` — 追加来源后缀 `` [<sourceId>-p02-audio]``（分 P 补零，音频加 `-audio`）。例：`标题 [BV1AB411c7mD-p02].mp4`。
3. `numeric` — 仍冲突则追加 ` (2)`、` (3)`……（可与 source_id 后缀组合）。

当磁盘上已存在**不属于本行**的文件、或另一条 DB 记录已登记该路径时，候选即视为"冲突"。并发通过 `data/output-path-reservations/` 下的**带心跳的锁文件**保护。锁可跨进程工作，失效锁可被回收（进程死亡检测 + 5 分钟过期）。

---

## 5. 发布模型（不覆盖、崩溃安全）

分配到路径后，文件**不会**被直接移动。而是由 `promoteFileNoOverwriteSync`：

1. 在与目标**同盘**的 `.mytube-staging/` 中暂存（避免跨设备移动）。
2. 通过**硬链接发布**到最终路径，并校验文件大小一致。
3. 硬链接不受支持时（EXDEV / EPERM / ENOTSUP 等）自动**降级为复制**。
4. 采用**不覆盖**语义（`wx` 标志 + claim marker）：若目标已存在则不覆盖。
5. 每一步都向 `data/output-family-journals/` 写日志（`staged` / `hard_linking` / `committed`），因此崩溃后可续做或清理。

---

## 6. 重新下载替换（同一记录）

当**同一条库记录**被重新下载时，可以替换它已经拥有的文件。`replaceOwnedFileWithBackupSync` 会备份当前文件（`.mytube-replace-backup`），执行替换，失败则回滚。

若目标路径发生变化（例如更改了模板或作者组织方式），旧的、现已无引用的文件由 `resolveSupersededManagedPath`（`backend/src/services/downloaders/supersededOutput.ts`）识别并删除。它比较**绝对路径**而非 basename，因此能捕获仅目录变化的情况，且绝不会删除刚刚写入的文件。

---

## 7. 全链路统一

所有写入媒体的路径都使用同一套分配器 + 发布模型，因此来源不同的媒体不会互相覆盖：

- yt-dlp 下载 · Bilibili（含多 P）· MissAV
- **批量重命名**（`renameJobService`）
- **合集迁移/重定位**（`collectionFileManager`）

---

## 8. 冲突审计与修复

- `mediaCollisionAuditService` — **只读**扫描，报告指向同一物理文件或存在冲突的记录。
- `mediaCollisionRepairService` — 配套的修复 / 重新下载管线，通过 `mediaCollisionAuditController` 暴露。

---

## 9. 受管的媒体服务器电视剧集库（可选）

> 需手动启用。除非你在设置中把**媒体服务器导出布局**设为
> `作者 → 播放列表季（托管电视剧媒体库）`，否则本节内容不会发生。默认值是
> `同目录边档`，即完全保持原有行为不变。

媒体服务器期望的是 `剧集 / Season NN / SxxExxx` 结构，而 `uploads/videos/` 的结构由你自己的
文件名与作者组织设置决定，二者不必一致。MyTube 不会强行改造其中一方，而是可以另外生成一个
**独立的受管镜像**：

```text
uploads/media-library/
└── Kurzgesagt/
    ├── tvshow.nfo
    ├── poster.jpg
    ├── Season 01/
    │   ├── season.nfo
    │   ├── S01E001 - Human Origins.mp4
    │   ├── S01E001 - Human Origins.nfo
    │   └── S01E001 - Human Origins-thumb.jpg
    └── Season 02/
        ├── season.nfo
        ├── S02E001 - Ants.mp4
        └── S02E001 - Ants.nfo
```

请把 **`uploads/media-library/`** 作为 *Shows（剧集）* 媒体库添加到媒体服务器。不要同时添加
`uploads/videos/`，否则每一集都会出现两次。

### 9.1 概念对应关系

| 来源概念 | 媒体服务器概念 |
|---|---|
| 频道 / 作者 | 一个剧集目录 + `tvshow.nfo` |
| 有来源身份的播放列表 | 一个带编号的季 + `season.nfo` |
| 一条 `(播放列表, 视频)` 归属关系 | 一集 |
| 不属于任何来源播放列表的视频 | `Season 00`，标题为 *Specials / Unassigned* |

只有具备**持久来源身份**的播放列表才会成为季 —— 即播放列表订阅以及 Bilibili 合集/系列。
你手动创建的收藏集不会被转成季。

### 9.2 原始文件不会被改动

镜像中的剧集是指回 `uploads/videos/` 中文件的**硬链接**。硬链接是同一份数据的第二个名字，因此：

- 不会移动、重命名或复制任何视频；
- 镜像通常**不占用额外磁盘空间**；
- 删除镜像不会影响原始文件。

硬链接只能在**同一文件系统内**工作。如果 `uploads/media-library/` 与 `uploads/videos/`
位于不同磁盘，或所在文件系统不支持硬链接，MyTube 会退回为复制，这**会**为每个受影响的视频
占用一份完整副本。重建结果摘要始终会报告有多少文件使用了硬链接、多少被复制。你也可以关闭该
回退行为，此时这些剧集会被报告为失败。

封面与缩略图始终使用复制而非硬链接，这样在 MyTube 内重新生成缩略图不会改动媒体服务器已扫描
到的图片。

### 9.3 稳定的编号

季与集的编号只分配**一次**，之后不再改变：

- 播放列表首次挂到某个剧集下时获得下一个可用的季编号。删除播放列表不会释放该编号供重用。
- 集编号取自 MyTube 首次导入该项时观察到的播放列表位置。若上游播放列表之后被重新排序，
  MyTube 只记录新位置用于诊断，**不会**给已有剧集重新编号。
- 上游播放列表顶部新插入的项目会获得下一个未使用的集编号，而不是 `E001`。

这里的"播放列表顺序"指 MyTube 稳定的首次导入顺序，而非持续变化的上游排序。这是有意为之：
重新编号会移动一整季的所有文件，并破坏媒体服务器中的观看记录。

重命名频道或播放列表只会更新 NFO 中的标题，目录名保持创建时的名称。

### 9.4 同一视频出现在多个播放列表

属于两个播放列表的视频会成为两集 —— 每季各一集，各自拥有独立的 NFO 与唯一 ID。两者通过硬链接
指向同一个原始文件，因此不额外占用空间。

### 9.5 将合集导出为独立剧集

默认情况下，合集是其作者剧集下的一**季**。但对于「合集本身就是剧名」的内容 —— 例如某个
UP 主发布的电视剧，其频道名对观众毫无意义 —— 这个默认就不合适了。此时 Plex 显示的是
UP 主的名字和头像，因为 MyTube 只声明了作者剧集这一个剧集。

打开合集并选择**导出为独立剧集**即可改变这一点。该合集随后会成为一个顶层剧集，包含单独的
`Season 01`，与作者剧集互相独立：

```text
uploads/media-library/
├── Kurzgesagt/                  ← 作者剧集，保持不变
│   └── Season 01/…
└── 人民的名义/                   ← 合集，已提升为独立剧集
    ├── tvshow.nfo
    ├── poster.jpg
    └── Season 01/
        ├── S01E001 - EP01.mp4
        └── S01E001 - EP01.nfo
```

该开关仅在受管库布局下出现；在「相邻附属文件」模式下并不存在可供提升的剧集。

**选择标题。** MyTube 提供三种命名方式，且绝不替你自动选择：

- **搜索 TMDB** —— 输入标题并选择匹配项。MyTube 随后保存 TMDB ID、官方标题、剧情简介、
  首播日期，并下载海报。只有通过严格校验的匹配才会被标记为高置信度；较弱的结果会被标注为
  建议项，仍需你明确确认。此功能需要在设置中配置 TMDB API 密钥。
- **手动输入** —— 自行输入标题。不发起网络请求，也没有海报。
- **使用合集元数据** —— 沿用合集自身的名称与描述。

TMDB 仅用于确定*剧集*的身份。集编号始终来自 MyTube 自己的分配器（§9.3），绝不来自 TMDB
—— 后者看不到你的文件。

**提升操作无法无损还原。** 如果该合集原本是某个作者剧集下的一季，开启此开关会将其移出：
原季目录被移除，剧集在新剧集下重新生成。集**编号**会被沿用，因此以 `SxxExxx` 为键的观看
记录得以保留，但该季在作者剧集下的季编号将被弃用且不再重用。再次关闭开关会让合集以一个
**新的**季编号回到作者剧集下。若你只是想给现有的季换个好看的标题，请改为重命名合集 ——
那只更新 NFO，不会移动任何文件。

关闭开关会保留已解析的 TMDB 元数据与海报，因此之后重新启用可直接复用同一身份，无需再次查询。

**目录名在启用时即固定。** 它由你接受的标题一次性生成、经文件系统安全化处理，之后永不重命名
—— 与 §9.3 中作者剧集的规则相同。下一次重建完成后，合集页面会显示实际创建的目录名；若标题
中有字符需要替换，或需要追加后缀以避免冲突，该目录名可能与标题不同。

### 9.6 清理安全性

MyTube 在 `uploads/media-library/` 下生成的每个文件都会记录在数据库的归属账本中。清理操作
**只**删除账本中列出的文件。你自己放进镜像目录的文件会被保留并报告为冲突，而不会被覆盖；
`uploads/videos/` 中的原始文件永远不会被触碰。

关闭该布局不会删除镜像。若要移除，请将导出模式设为**关闭**并执行清理操作。季与集的编号会被
保留，因此之后重新启用会生成完全相同的目录结构。

---

## 小结

稳定身份 → 文件名（legacy 或 Liquid 模板；`{{ id }}` = 来源 id，推荐带 `[source_video_id]` 以防碰撞）→ 作者文件夹物理组织 → 分配器整体预留文件家族并按 `none → source_id → numeric` 让位 → 通过暂存 + 硬链接（可降级复制）的不覆盖发布落盘，全程有锁与日志保证并发与崩溃安全。
