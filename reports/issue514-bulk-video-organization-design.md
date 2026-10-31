# Issue #514：批量添加视频标签与加入合集设计

- 需求：[Bulk selection of videos for adding tags and adding to collections](https://github.com/franklioxygen/MyTube/issues/514)
- 日期：2026-10-30
- 原设计基线：`b74a40c6`；首次 PR 整合基线：`03df96e9`；当前已同步 `master` 的 `d9934d4f`，包含 #523、#524、#526、#527、#528 的依赖更新。
- 状态：Codex 自行审查通过；第一版已实现。PR 整合、审查修复及验证记录见第 12–15 节。
- 实现分支：`feat/issue-514-bulk-organization-pr`
- 本次交付：设计、批量整理实现、接口文档和相关测试。

## 1. 目标与范围

用户能在视频列表中选择多个已入库视频，用一次操作为它们追加一个或多个标签，或加入一个合集，减少大量导入后的整理成本。

第一版覆盖以下入口，使用同一套选择状态和批量请求逻辑：

| 页面 | 第一版行为 |
| --- | --- |
| 首页的全部视频、历史记录视图 | 增加选择模式、卡片复选框和批量工具栏 |
| 全部标签页 `/tags` | 在筛选结果中选择视频并执行批量整理 |
| 管理页的视频表格 | 保留现有多选和删除入口，新增批量标签，将批量合集改用新接口 |
| 首页合集卡片视图、收藏视图 | 不显示本功能；合集卡片不代表一个可选视频 |
| 作者视频页、合集详情页、本地搜索结果 | 后续可接入共享组件；不作为本期验收前提 |

第一版只支持追加标签及加入一个目标合集。标签删除、标签替换、批量移出合集、批量修改其他字段、服务器按筛选条件选中整库，不包含在此需求中。合集详情页已有的“修改整个合集的公共标签”保留原语义，不与“选中部分视频追加标签”混用。管理页原有批量删除不迁移到新增批量接口，也不增加删除能力。

核心约束：保留每个视频原有标签及合集关系；加入合集不移动媒体文件；一次请求整体成功或整体回滚；重复执行追加操作不会产生重复标签或关联。

## 2. 当前实现与接入依据

以下事实来自上述代码基线，拟新增文件见第 9 节。

| 现有位置 | 当前行为与设计影响 |
| --- | --- |
| [VideosTable.tsx](../frontend/src/components/ManagePage/VideosTable.tsx) | 已有 `selectedVideoIds`、全选当前页、批量删除及加入/创建合集。合集使用 `Promise.all` 逐个调用；全选状态仅比较数组长度，跨页时不可靠。现有选择应替换为共享 hook。 |
| [CollectionContext.tsx](../frontend/src/contexts/CollectionContext.tsx) | `addToCollection` 每次成功均刷新缓存、提示成功。新批量请求不循环调用这个单视频方法，以免发出 N 个请求和 N 条提示。 |
| [TagsModal.tsx](../frontend/src/components/TagsModal.tsx) | 维护单视频完整标签列表；可先保存全局 settings，再调用 `onSave`。该保存流程不能直接用于批量追加。 |
| [Home.tsx](../frontend/src/pages/Home.tsx)、[AllTagsPage.tsx](../frontend/src/pages/AllTagsPage.tsx)、[VideoGrid.tsx](../frontend/src/components/VideoGrid.tsx) | 已有客户端筛选、排序和分页；首页及标签页共用网格。集合视图可能将视频渲染为 `CollectionCard`。 |
| [VirtualizedVideoGrid.tsx](../frontend/src/components/VirtualizedVideoGrid.tsx) | 虚拟列表根据 `sortedVideos` 渲染，离开视口的卡片会卸载；选择状态不能放在卡片内部。 |
| [VideoCard.tsx](../frontend/src/components/VideoCard.tsx) | 有自定义 `React.memo` 比较函数，加入选择 props 时必须同步比较；主点击区域、作者入口、标签及卡片菜单需要处理选择模式的事件。 |
| [VideoContext.tsx](../frontend/src/contexts/VideoContext.tsx) | 列表缓存为 `['videos']`；单视频更新发送完整 `tags` 数组，且 `updateVideo` 失败时可能返回 `{success:false}` 而不抛异常。不能用“循环调用后 Promise 正常结束”判断整批成功。 |
| [videoController.ts](../backend/src/controllers/videoController.ts) | 单视频标签更新后同步全局标签目录，并调用媒体服务器 sidecar 同步。新增批量路径要明确这些副作用。 |
| [tagService.ts](../backend/src/services/tagService.ts) | `addTagsToGlobalSettings` 按大小写不敏感去重，但会捕获异常并返回 false；不适合直接承担严格事务中的目录写入。 |
| [settings.ts](../backend/src/services/storageService/settings.ts) | settings 是 SQLite key/value 数据；`getSettings` 有 30 秒缓存且错误时可能回退。批量事务需直接读取/写入 `tags` 那一行，并在提交后失效缓存。 |
| [collectionController.ts](../backend/src/controllers/collectionController.ts)、[collections.ts](../backend/src/services/storageService/collections.ts) | 手动加入合集已显式传 `moveFiles:false`。底层默认策略仍可能移动文件，新批量路径只写关联表。 |
| [collectionRepository.ts](../backend/src/services/storageService/collectionRepository.ts) | 单条追加有条件 INSERT；`saveCollection` 会删除并重建整个关联集。批量追加不应循环加载完整合集，也不调用全量重建。 |
| [schema.ts](../backend/src/db/schema.ts) | `videos.tags` 是 JSON 文本；`collection_videos` 以 `(collection_id, video_id)` 为主键，外键级联删除；`order` 保存合集顺序。无需新增业务表或迁移。 |
| [videoListRevision.ts](../backend/src/services/storageService/videoListRevision.ts) | 视频列表通过进程内 revision 生成 ETag。批量修改标签必须在提交后递增，否则列表刷新可能拿到旧数据的 304。 |
| [apiRoutes.ts](../backend/src/server/apiRoutes.ts)、[roleBasedAuthMiddleware.ts](../backend/src/middleware/roleBasedAuthMiddleware.ts) | 主 API 经过认证和角色检查；访客禁止整理写入；关闭登录时允许管理操作。新增接口保持该部署模式。 |

## 3. 用户流程

### 3.1 进入选择模式

首页全部视频/历史视图及标签页列表头增加“选择视频”。点击后显示卡片复选框和工具栏。管理页沿用表格常驻复选框；有选择时显示相同的整理操作。

```text
[全选当前页 □]  已选 12 个视频（跨 2 页）
[添加标签]  [加入合集]  [清空选择]  [退出选择]
```

工具栏位于列表顶部并使用 sticky，在窄屏可换行。按钮文字明确使用“加入合集”，不再用会暗示文件搬迁的“移动合集”。零选择时两项整理操作禁用。

选择模式中，点击卡片主体切换选中状态，不打开播放器；复选框与主体点击不能叠加切换两次。卡片的作者跳转、标签筛选、播放菜单及单视频修改入口暂时禁用或隐藏；悬停预览也停用。复选框置于 `CardActionArea` 外的同级覆盖层，避免在按钮内部嵌套另一个可交互元素。复选框有包含视频标题的可访问名称，支持 Tab 和 Space，选中数用 `aria-live="polite"` 宣告。

### 3.2 选择范围与生命周期

单次最多选择 **500** 个视频。前后端使用同一个契约值；前端不自动拆成多个请求，避免破坏整批回滚语义。

| 用户行为 | 选择状态 |
| --- | --- |
| 翻页、改变排序 | 保留 ID 集合，工具栏展示总选中数；全选框只根据当前页 ID 的交集计算 |
| 修改标签筛选、管理页搜索词 | 清空选择并保持选择模式，选中计数立即更新为 0，并通过 aria-live 宣告 |
| 切换首页视图、离开页面、切换管理页 tab | 退出选择模式并清空；不存入 URL、localStorage 或全局 VideoContext |
| 虚拟列表卡片卸载/重新出现 | 保留选择；重新出现时从父级 ID 集合还原复选框 |
| 后台刷新确认视频已从视频库删除 | 从选择集合剔除已删除 ID，并更新计数；不能把分页或暂时无数据当成删除 |
| 权限检查中、退出登录或失去写权限 | 隐藏入口、关闭整理弹窗并清空选择 |
| 成功保存一个整理操作 | 关闭弹窗，保留已选 ID，允许接着执行另一种整理操作；用户可主动清空或退出 |

分页模式的“全选当前页”只增选该页 ID；再次取消全选只移除该页 ID，保留其他页选择。`checked` 表示本页全部选中，`indeterminate` 表示本页部分选中，不能拿总选中数与本页数量比较。如果增选会超过 500，则整个增选动作不执行并提示上限，不静默截断。

虚拟列表模式中的 `sortedVideos` 已是加载到客户端的完整筛选结果，DOM 可见卡片数量不是结果总数。因此显示“全选当前结果（N）”；N 超过 500 时禁用该按钮，说明可以缩小筛选范围或逐个选择至 500 条。第一版不提供“全选整库”。

弹窗打开时冻结本次操作的 ID 数组和选择范围版本；标签/合集草稿在保存时冻结为操作参数，标题显示“为 N 个视频添加标签”或“将 N 个视频加入合集”。列表刷新不应悄悄改变本次提交的数量。真正保存前仍由服务端在事务内检查这些 ID。

### 3.3 批量标签弹窗

- 从空的“本次要添加的标签”集合开始，不把所选视频标签的并集/交集当作待保存列表。
- 显示全局标签建议，支持一次选择多个标签或输入新标签；明确提示“保留原有标签，仅追加所选标签”。
- 本次允许 1–20 个标签，trim 后每个 1–80 个 Unicode 字符；拒绝空标签和控制字符。按 JS `toLowerCase()` 去重，与现有大小写规则一致，不引入 Unicode 兼容归一化。
- 未保存的新标签只在弹窗草稿中存在。保存时只发一个批量请求，不调用 settings 保存接口。
- 已包含目标标签的视频计为“无需更改”，整体仍成功；关闭弹窗不会删除既有标签。
- 标签业务输入可抽取无副作用的 `TagPicker` 供两个弹窗共享；现有 `TagsModal` 的单视频替换语义保持不变。

### 3.4 批量合集弹窗

- 可搜索并选择一个既有合集，或“新建合集并加入”；显示 N 个目标视频。
- 明确提示“保留原有合集归属，视频文件位置不变”。支持向手动合集、自动作者合集及历史合集新增关系，沿用既有手动加入的能力。
- 新建草稿首次提交时生成 UUID v4 作为候选合集 ID（优先 `crypto.randomUUID()`，HTTP NAS 环境使用 `crypto.getRandomValues()` 生成标准 v4）；重试同一草稿必须复用这个 ID，不每次重新生成。
- 新接口对新建名称冲突返回 409，并提供既有合集 ID。弹窗保留选择，让用户明确选中既有合集后再加入；不自动生成编号名称，也不静默合并。
- 这是新增批量接口的冲突语义；旧单视频创建接口现有“同名则加入”的行为不改。显示组件可复用搜索、加载及防重复点击交互，批量保存逻辑使用独立回调。

### 3.5 保存、出错与重试

同一选择范围一次只允许一个整理请求在途。保存期间禁用重复保存、弹窗关闭、复选框及当前页面的筛选/排序/分页操作。浏览器返回、页面卸载不拦截，但不能承诺取消已发送的请求会撤销服务端写入。

- 收到 200：只显示一条汇总提示，例如“已为 10 个视频添加标签，2 个无需更改”；所有无需更改时提示“所选视频已包含这些标签”。
- 400/409/500：弹窗、标签草稿/合集草稿及选择保留，展示错误，不显示成功；数据库异常必须回滚。
- 404（部分视频已删除）：提示“有视频已不存在，本次未修改任何视频”，刷新库，展示丢失数量；用户点击“移除失效项并重试”后生成新的快照。不自动缩小请求后静默保存。
- 401/403：刷新认证状态，停止可用的整理入口；数据库不应写入。
- 网络断开、超时：明确结果尚未确认，保留同一请求参数，允许人工重试；不自动重试，不提示“已回滚”。服务端可能已提交，重试须安全。
- 服务端保存成功而缓存刷新失败：显示“已保存，列表刷新失败”，提供“刷新列表”；不得当成保存失败重发创建请求。

## 4. 前端结构

建议新增 `useVideoSelection`、`useBulkVideoActions`、`VideoBatchToolbar`、`BulkTagsModal`、`BulkCollectionModal`；页面持有 hook，卡片与表格仅消费 props。

```ts
type VideoSelection = {
  selectionMode: boolean;
  selectedVideoIds: ReadonlySet<string>;
  toggle: (id: string) => void;
  togglePage: (ids: readonly string[]) => void;
  clear: () => void;
  enter: () => void;
  exit: () => void;
};

type VideoCardSelectionProps = {
  selectionMode?: boolean;
  selected?: boolean;
  selectionDisabled?: boolean;
  onSelectionToggle?: (id: string) => void;
};
```

`useVideoSelection` 另接收 `scopeKey`、完整库可用 ID、`canWrite`。`scopeKey` 包含页面身份、首页视图、筛选标签（排序后编码）、管理页搜索词/tab，不包含页码与排序。scope 改变后提交入口必须立即失效，不能只依赖普通 effect 清空，避免旧选中 ID 在新筛选下还有一帧可以提交。使用绑定 scope 的状态/版本检查处理这一点。

打开弹窗时，将选中 ID 按**当前排序结果的相对顺序**生成数组并冻结；因后台元数据变化而暂时不在结果中的已选项按原选中顺序附加，不能静默漏掉；API 按该数组顺序追加合集，前后端不再各自重排。selection hook 使用 Set 的插入顺序仅用于内部状态，不作为合集最终顺序契约。

`VideoGrid` 传递每个视频的 `selected` 布尔值及稳定的 toggle 回调；`VirtualizedVideoGrid` 使用稳定的 `computeItemKey`（视频 ID），不依赖卡片局部 state。选择 props 必须加入 `VideoCard` 的自定义 memo comparator。为避免无关卡片频繁重渲染，不把整个 Set 传给每张卡片。

批量 mutation 使用专用 `api.post`，设置 `retry:false`。前后端 DTO 均显式定义，不能把 `Partial<Video>` 当作批量写入契约。回调携带 `scopeVersion`；请求结束即使已换页或卸载仍须处理共享缓存，但只能在 scope 仍一致时修改当前选择或关闭弹窗。

前端写权限使用认证状态完成后的 `!loginRequired || userRole === 'admin'`，与后端一致；不能仅检查 `userRole !== 'visitor'`，因为认证未完成时角色也可能为 null。

## 5. 批量接口契约

新增两个 POST 接口，均放在当前 `apiRoutes` 的认证/角色链路内，并使用现有 `requireAdmin` 和 `asyncHandler`，路由定义显式设置 `allowApiKey:false`。当前 `buildApiRouter(true)` 会为这些定义注册拒绝 API key 的处理器，不应把批量写入实现暴露到该提前执行的路由链。登录关闭时 `requireAdmin` 仍允许管理；访客、启用登录时的未认证请求及 API key 凭据被拒绝。沿用现有 CSRF 防护和共享 API client，不增加豁免。

公共校验：原始 `videoIds` 数组长度 1–500；元素必须为非空、无首尾空白、最长 200 字符的字符串，禁止数字隐式转换；稳定去重后处理，`requestedCount` 是去重后的数量。请求体、操作分支及字段类型必须明确，拒绝无关写入字段。所有 ID 查询使用绑定参数，不拼接用户 SQL。限制的是请求原始长度，不能用大量重复 ID 绕过上限。

以下为新增协议；错误细节只对新接口扩展，不要求重写旧 API 的错误格式。

### 5.1 `POST /api/videos/batch/tags`

```json
{
  "videoIds": ["v1", "v2", "v3"],
  "tags": ["学习", "Music"]
}
```

```json
{
  "success": true,
  "data": {
    "requestedCount": 3,
    "changedVideoIds": ["v1", "v3"],
    "unchangedVideoIds": ["v2"],
    "catalogChanged": true,
    "videos": [
      {"id": "v1", "tags": ["原标签", "学习", "Music"]},
      {"id": "v2", "tags": ["学习", "Music"]},
      {"id": "v3", "tags": ["学习", "Music"]}
    ]
  }
}
```

200 响应包含所有请求视频的权威标签字段，包括无需更改的项，供重试后修正客户端缓存。现有标签相对顺序保持，新标签按规范化后的请求顺序追加。

标签匹配规则：输入 trim 后按 lower key 去重；全局目录已有同 key 标签时，新追加值采用目录的原始拼写。某视频已有同 key 标签时保留该视频原始拼写，不重写旧标签。例如目录为 `Music`，视频已有 `music`，输入 `MUSIC`，该视频保持 `music`；没有该标签的视频追加 `Music`。其他旧标签一律保留，历史同 key 重复项本期不做清洗。

### 5.2 `POST /api/collections/batch-add`

加入既有合集：

```json
{
  "videoIds": ["v1", "v2"],
  "collectionId": "existing-collection"
}
```

新建并加入：

```json
{
  "videoIds": ["v1", "v2"],
  "newCollection": {
    "id": "82b67b4e-b490-48ef-8ac7-577310286cf1",
    "name": "待学习"
  }
}
```

`collectionId` 与 `newCollection` 必须且只能出现一个。既有 ID 采用公共 ID 校验。新 ID 要求合法 UUID v4。新名称 trim 后长度 1–200，禁止控制字符及文件系统不安全字符；在新接口校验失败时直接 400，不静默改名/截断。仍按现有后端的精确 `name` 匹配、历史 `title` 回退识别重名，不增加大小写不敏感的数据库唯一约束；UI 可以提示相似名称，但不能把模糊匹配当作服务端唯一性保证。

```json
{
  "success": true,
  "data": {
    "requestedCount": 2,
    "changedVideoIds": ["v2"],
    "unchangedVideoIds": ["v1"],
    "collection": {
      "id": "existing-collection",
      "name": "待学习",
      "created": false
    }
  }
}
```

无论本次创建还是加入都返回 200，`created` 只表示本次事务是否新建了合集。响应不返回目标合集全量视频，避免大合集产生过大响应；前端统一刷新 `['collections']`。

同一新建草稿重试时：若候选 ID 已存在且 `origin='manual'`、name/title 与请求一致，则当作加入这个合集，不再次创建；若 ID 存在但不符合草稿身份条件，返回 409，不覆盖/重命名既有对象。若 ID 不存在但名称已存在，409 返回既有合集 ID，用户可明确改为 `collectionId` 请求。若两次请求之间合集被删除或重命名，重试可以返回 404/409；不承诺在并发删除、重命名后复现原响应。追加标签和关联在目标保持存在时具有数据幂等性，不新增通用请求日志表。

### 5.3 失败响应

| HTTP | 条件 | 数据库行为 / 前端处理 |
| --- | --- | --- |
| 400 | 空数组、原始数组超限、非法 ID/标签/名称、两个目标分支同时出现 | 不写入；保留草稿并显示校验错误 |
| 401 / 403 | 未认证、访客、API key、CSRF 不通过 | 不写入；沿用已有认证/CSRF 响应 |
| 404 | 任一视频不存在，或指定既有合集不存在 | 整批不写入；返回缺失 ID，供用户修正后重试 |
| 409 | 名称/候选 ID 冲突、所选视频标签 JSON 损坏 | 整批不写入；保留草稿，不覆盖损坏数据 |
| 500 | 查询、写入或提交失败 | 整批回滚；返回通用错误，内部日志记录原因 |

例如缺失视频：

```json
{
  "success": false,
  "error": "Some selected videos no longer exist",
  "type": "not_found",
  "details": {"missingVideoIds": ["v3"]}
}
```

新接口 controller 可显式用 `errorResponse` 返回预期的 400/404/409 细节，数据库异常继续交给 `asyncHandler`/全局错误处理器。不得只抛现有 `NotFoundError` 却假定全局处理器会自动序列化自定义 `details`。

## 6. 服务端写入与一致性

### 6.1 事务边界

使用当前 Drizzle/better-sqlite3 的同步事务，通过 `db.transaction((tx) => ..., {behavior:'immediate'})` 在读写前取得写锁。所有存在性检查、当前标签读取、目录合并、重名检查、顺序计算及关联插入必须使用传入的 `tx`。事务内不 `await`，不执行文件 I/O、网络调用或依赖全局缓存的 helper。

单次最多 500 个 ID，选取所需字段，不能循环读取整个视频库/完整合集。事务失败直接抛出，不能由旧 helper 吞掉错误后视为成功。

### 6.2 标签事务

1. 一次读取所选视频的 ID 和 tags，确认全部存在；缺失任意项则退出且不写入。
2. tags 为 null 或空文本时按空数组处理；其他值须为合法字符串数组。解析失败或元素类型不正确则 409，不能把损坏 JSON 当作空数组覆盖。
3. 直接通过 `tx` 读取 settings 的 `tags` 行；不存在时按空目录处理，已存在但不是合法字符串数组时也按冲突中止。禁止通过有缓存/回退的 `getSettings()` 做事务事实来源。
4. 为本次输入建立 lower-key 与规范拼写映射，仅将新 key 追加到每个视频的标签数组；未发生变化的视频不执行 UPDATE。目录仅补充实际应用的请求标签，不重写其他 settings 行。
5. 所有视频 UPDATE 与 settings.tags 的 upsert 在同一个事务内完成。只更新 tags，不把客户端旧 Video 对象回写到数据库。
6. 事务成功返回权威结果。提交后：有视频变化时 `bumpVideosListRevision()` 一次；目录变化时 `invalidateSettingsCache()` 一次；标签变化时失效已有 recommendation signals 缓存，避免后台标签聚合仍反映旧状态。

不要在该事务中直接调用 `updateVideo`、`addTagsToGlobalSettings` 或 `saveSettings({...allSettings})`：它们会提前触发 revision/缓存行为、吞掉错误或带入无关字段。可以抽取接收 `tx` 的无副作用底层函数，旧单条接口本期不必整体重构。

### 6.3 合集事务

1. 事务内确认所有视频存在，再处理目标；不得先创建空合集后才发现视频 ID 有误。
2. 既有分支读取目标合集；新建分支按第 5.2 节处理候选 ID/名称冲突。新行使用请求 UUID，设置 `origin='manual'`、`name=title`、`createdAt`。
3. 查询该合集与请求 ID 的已有关系，以及目标合集现有 `MAX(order)`；不读取/重建全量关系。
4. 仅给缺失成员追加关系，从 `COALESCE(MAX(order),0)+1` 递增，顺序遵循请求数组。使用已有复合主键的冲突保护；不重新排序已有成员，不删除其他合集关系。
5. 只在确有新增成员时更新目标合集 `updatedAt`。记录 changed / unchanged ID 并提交。事务内新建合集和关联一起回滚。

新增路径不调用可能移动文件的 `linkVideoToCollection` 默认分支，也不调用 `saveCollection` 全量重建。既有视频字段不变，合集追加无需递增视频表 revision；前端刷新合集缓存即可反映卡片分组与计数。

### 6.4 媒体服务器导出等副作用

标签保存会影响 NFO/source JSON。数据库是成功判据，文件导出不纳入 SQLite 事务：提交失败时不得生成任何 sidecar；提交成功后仍须复用 `syncMediaServerArtifactsForRecord` 更新已更改视频。

为避免 500 个同步文件导出拖慢 HTTP 请求，controller 在提交和 revision/cache 处理后返回响应，再用 `setImmediate` 分段执行尽力而为的 sidecar 同步，每段最多 10 个视频，每段之间让出事件循环。导出开启且实际需要整库上下文时，整批只加载一次并传递 `libraryVideos`，不每个视频重新扫描整库。调度最多保留 5,000 个去重 ID，多个批次对同一 ID 合并；超出容量时对丢弃数量记录警告，数据库结果仍成功，可使用现有重建功能补齐。每个同步分段开始时检查视频列表 revision，发生变更则重新加载共享上下文，以免较旧的 libraryVideos 快照覆盖后续编辑；没有变化时复用快照。共享上下文使用 `getVideosStrict()` 读取；读取失败进入错误日志路径，不能将读取失败当成空库或视频被删除。数据库 import/restore 改变 generation 时清空旧队列和快照，不在替换后的数据库上执行旧任务。视频已删除时跳过。

这一调度是可丢失的派生文件刷新，不是持久后台任务：重启可能丢失未执行项，现有媒体导出重建功能用于修复；单个视频导出出现意外异常时，记录对应视频 ID 并继续本段及后续分段；失败项不自动重排，以免不可写文件造成无限重试。日志记录导出失败，HTTP 数据成功不改报失败。若产品后续要求重启后保证 sidecar 完成，应另做持久任务机制，不在本需求中暗示已有该保证。合集关联追加不变更视频路径，不触发文件搬迁或额外导出。

## 7. 客户端缓存与反馈

服务端确认保存后，再更新缓存，不在本期做乐观标签合并。

| 操作 | 缓存处理 |
| --- | --- |
| 批量标签成功 | 取消正在进行的 `['videos']` 和相关 `['video', id]` 查询，再统一失效/刷新视频、详情和 `['recommendations', 'signals']` 推荐信号缓存。第一版不把批量响应直接合并进共享缓存，避免权限切换后注入旧管理员数据；当前会话通过 GET 获取权威结果，不创建 500 个详情缓存。 |
| 标签目录变化 | 失效 `['settings']`；刷新失败保留已保存状态并提示可刷新，不整份回写客户端旧 settings。 |
| 批量合集成功 | 按前缀失效 `['collections']`、`['favorite-collections']`，刷新所有对应用户 scope 的派生计数和封面；无需循环调用 `fetchCollections()`。 |
| 网络结果未知 | 使用本次 operation 刷新对应缓存：标签操作刷新视频、相关详情、推荐信号及 settings（无法确认目录是否改变）；合集操作刷新所有 scope 的合集与收藏合集。保留原草稿及候选 UUID 供人工重试，不自动重复 POST；刷新失败不替换原始写入错误，也不据此推断保存失败。 |
| 页面已离开或权限 scope 改变 | 回调不可恢复旧弹窗或清空新页面的选择；认证 scope 已改变时不把旧管理员响应里的标签写进当前会话的视频缓存。 |

mutation 的保存结果与后续 refetch 分开处理。缓存刷新异常不得把已成功的 200 变成 mutation 写入失败。每批最多一条成功提示；旧单视频 mutation 的逐条 snackbar 不参与。

## 8. 验收与测试计划

以下为设计阶段确定的测试计划；实际执行结果与范围见第 12 节。

### 8.1 服务端集成测试（使用隔离的真实 SQLite）

- 对具有不同旧标签的视频追加多个标签，保留各自原数据；大小写规范与请求顺序符合契约；相同请求重复执行不重复添加。
- 第二个视频写入、目录 upsert 或提交失败时，全部视频与目录均保持原状；revision 不增加，settings 缓存不发布新值，sidecar 不运行。不能只 mock transaction callback 来证明回滚。
- 缺失 ID、损坏 JSON、错误元素类型、混合目标、新名称冲突、0/500/501 个原始 ID、重复 ID、20/21 个标签及 80/81 字符边界。
- 向已有数千成员的合集追加部分重复的视频；已有 order 不变，新 order 连续且遵循请求数组；其他合集关系、视频路径、文件都不变。
- 新建并加入原子提交；重复使用候选 UUID 不产生新合集；失败不留下空合集；并发同名/同 UUID 请求不能覆盖既有对象。
- 使用独立 SQLite 连接模拟外部写入，证明 immediate 事务中的读改写不会丢失另一笔已提交追加；多个用户整理不同标签时不互相覆盖。
- 测试真实路由链：登录开启时 admin 允许、visitor/未登录拒绝；API key 拒绝（包括登录关闭时）；登录关闭且无 API key 时允许；CSRF 缺失拒绝。确认新路由不会落入参数路由。
- `GET /videos` 旧 ETag 在标签变更后返回新内容；全是 no-op 时允许继续返回原 ETag；目录单独变化仍失效 settings 缓存。
- sidecar 只在提交后调度、导出异常不改数据库成功结果、同 ID 合并读取最新记录，且关闭导出时不扫描整库。

### 8.2 前端行为测试

- 卡片与表格选择一致；跨页、排序、虚拟列表卸载不丢选择；全选框根据当前页交集计算；取消本页全选保留其他页。
- 修改过滤器/搜索、切换视图/tab、退出及权限变化时正确清空；删除剔除不能误用当前页数据。
- 最大 500、超限增选整体拒绝、虚拟结果全选禁用条件及显示范围。
- 单次卡片点击/checkbox/Space 只切换一次，不导航；memo comparator 不阻止勾选视觉更新；默认非选择模式仍可播放。
- 标签草稿初始为空、取消无写入、保存只发一个请求，既有 `TagsModal` 仍保存完整单视频标签列表。
- 保存期间不可重复触发；成功只提示一次并保留选择，允许接着加入合集；失败保留草稿，丢失视频需显式移除后重试。
- 新建失败/超时重试复用 UUID；200 后 refetch 失败显示已保存，不二次创建；卸载/换 scope 后响应不影响新选择。
- 批量响应不直接回写视频对象，刷新不会覆盖别处新改的标题/进度；无旧详情缓存时不创建大量缓存；认证 scope 改变不注入旧响应。
- 回归管理页既有批量删除、单视频标签、单视频合集、合集公共标签、收藏合集计数及首页合集分组。

### 8.3 手工与性能验收

1. 桌面分页：在两页选择 12 个视频，追加 2 个标签，再加入同一合集；原标签/其他合集保持，提示与真实数量一致。
2. 虚拟列表：选中后滚出视口再返回；标签筛选变更后选择清空；500 上限不会静默截断。
3. 窄屏与键盘：工具栏不遮挡视频，复选框易点击、焦点可见；所有操作能用键盘完成；英文、中文新增文案及项目其他 locale 的键覆盖通过现有检查。
4. 10,000 视频库、目标合集 5,000 成员、一次 500 视频：数据库操作不随整个合集规模逐视频重复水合，不发 N 个 HTTP 请求。记录事务耗时、请求耗时及内存；开发机目标数据库事务 P95 < 1 秒、导出关闭时 HTTP P95 < 2 秒，不把该目标表述为低配 NAS 的保证。
5. 导出开启时 HTTP 不等待 500 个文件写入；后台分段执行，不产生每视频一次整库读取；中途重启不影响已经提交的标签/合集数据。

## 9. 实施拆分与文件清单

| 顺序 | 拟变更文件/模块 | 完成标准 |
| --- | --- | --- |
| 1 | 新增后端 `services/bulkVideoOrganizationService.ts`、`controllers/bulkVideoOrganizationController.ts`；修改 `routes/api.ts` | 两个接口、严格校验、事务、幂等追加、权限及真实 SQLite 测试完成；复用现有 schema，不迁移 |
| 2 | 新增后端 `services/mediaServerExport/bulkArtifactRefresh.ts` | 提交后分段刷新、同 ID 合并、最新记录读取、无导出时不扫描整库 |
| 3 | 新增前端 `hooks/useVideoSelection.ts`、`hooks/useBulkVideoActions.ts`、批量 DTO | 选择范围、500 上限、冻结快照、保存/刷新状态分离、缓存处理测试完成 |
| 4 | 新增 `components/VideoBatchToolbar.tsx`、`BulkTagsModal.tsx`、`BulkCollectionModal.tsx` | 两种整理流程、出错重试、聚合提示、可访问性；按需要抽取纯 `TagPicker`，不复用旧 settings 写入流程 |
| 5 | 修改 `Home.tsx`、`HomeHeader.tsx`、`AllTagsPage.tsx`、`VideoGrid.tsx`、`VirtualizedVideoGrid.tsx`、`VideoCard.tsx` | 首页全部视频/历史和标签页提供入口，普通与虚拟卡片行为一致，memo 比较完整 |
| 6 | 修改 `ManagePage.tsx`、`ManagePage/VideosTable.tsx` | 替换选择状态，新增标签入口，合集改用一次批量请求；保留原有删除流程和失败处理 |
| 7 | 更新 `utils/locales/*`、API 文档及相关测试 | 新协议文档同步；运行受影响测试、前端 typecheck/lint 和后端 build，完成手工验收 |

API 文档同步至 [英文接口文档](../documents/en/api-endpoints.md) 与 [中文接口文档](../documents/zh/api-endpoints.md)。按上述顺序在一个功能分支实现。

## 10. 设计决策与边界

- 使用服务端批量事务，避免客户端 N 次完整标签替换造成并发覆盖、部分成功和大量通知。
- 使用独立追加语义，避免把单视频“编辑标签”扩展成含糊的多视频替换操作。
- 保留跨页选择但筛选变化即清空；范围有明确上限，避免用户无意操作已经看不到的视频。
- 第一版不提供部分成功响应；选中项失效时用户修正后重试，协议和反馈保持一致。
- 新建合集使用稳定候选 UUID 并显式处理名称冲突，避免“创建成功但响应丢失”重试产生多个合集。
- SQLite 保证数据库操作原子性；文件导出是独立、尽力而为的派生数据刷新，不能用它的失败声称数据库回滚。

## 11. 自行审查结论（2026-10-30）

Codex 对原子性、并发追加、选择范围、缓存及派生文件行为进行设计审查，修订如下。

| 发现 | 修订 |
| --- | --- |
| HTTP NAS 环境可能没有 `crypto.randomUUID` | 使用 Web Crypto 随机字节生成 UUID v4 作为兼容方案，失败重试复用同一草稿 ID |
| 媒体导出队列容量、旧上下文和数据库替换行为不明确 | 固定去重容量 5,000，记录溢出警告；按 revision 刷新上下文；generation 改变时丢弃旧任务 |
| 批量响应在认证会话切换后可能污染缓存 | 第一版仅取消旧查询并失效/刷新，不直接把旧响应合并进缓存 |
| 弹窗打开和提交时的快照边界不一致 | 打开时冻结视频 ID，保存时冻结草稿参数；后台变化不能静默漏掉已选项 |

结论：上述修订后通过设计审查，可进入第一版实现。关键发布条件为真实 SQLite 回滚/幂等测试、权限路由验证、跨页选择及虚拟卡片行为测试、前后端类型/构建检查。

## 12. 实现与验证记录（2026-10-30）

已在 `feat/issue-514-bulk-organization-pr` 实现第一版：两个原子批量接口、后置媒体元数据刷新、共享选择状态、批量标签/合集弹窗，以及首页全部视频/历史、全部标签页和管理表格入口。弹窗按需加载。PR 基于最新 `master` 整合；保留上游新增的滑动分页、缩略图回退、管理页扫描状态及空合集清理行为。

### 首次 PR 提交基线上的自动检查

隔离工作区以 `03df96e9` 为基线，使用 lockfile 重新安装依赖后运行：

| 检查 | 实际结果 |
| --- | --- |
| 后端全量测试 | 257 个文件、3,746 项通过，含本功能真实 SQLite 回滚、提交失败、写锁、幂等、权限/CSRF、队列及路由测试 |
| 前端全量测试 | 208 个文件、2,255 项通过，包含选择、弹窗、页面回归和 39 项 locale/KEY_LIST 检查 |
| 前端 TypeScript | `npm --prefix frontend run typecheck` 通过 |
| 前端 lint | `npm --prefix frontend run lint` 通过 |
| 前端生产构建 | `npm --prefix frontend run build` 通过，两个批量弹窗生成独立代码块 |
| 后端 TypeScript 构建 | `npm --prefix backend run build` 通过 |
| diff 空白检查 | `git diff --cached --check` 通过 |

与上游整合时解决了全部标签页的滑动分页容器冲突，并重新生成 locale `KEY_LIST.md`。原工作区的未提交统计修改不在 PR 中；此前旧工作区的后端构建阻塞不适用于本 PR。

后端容量冒烟在 10,000 个视频、5,000 个既有合集成员的隔离 SQLite 库上处理 500 个视频，验证标签追加及合集追加的数量与结果；这不是低配 NAS 的 P95 性能测量。

### 浏览器 → API → SQLite → 页面

以下浏览器验收在原设计基线 `b74a40c6` 上完成；整合最新基线后另完成上表全量回归。使用临时目录中的独立数据库和实际认证/角色/CSRF/业务路由启动服务，没有使用用户媒体库，也没有将批量接口 mock 为成功。Playwright 使用独立浏览器会话。

1. 首页分页每页 2 个视频，先全选第一页，再到第二页选择 1 个视频，工具栏保持跨页共 3 项。
2. 标签弹窗输入 `BatchA`（按回车加入）和 `BatchB`（直接点击保存），一个 POST 完成追加。SQLite 确认：`e2e1` 保留 `Existing` 并新增两个标签；`e2e3/e2e4` 新增两个标签；未选中的 `e2e2` 保持空数组。全局标签目录同步更新，页面刷新成功且保留选择。
3. 同一批 3 个视频加入已有合集，一个 POST 成功。SQLite 关联顺序为 `e2e4 → e2e3 → e2e1`，符合当前列表排序。
4. 对实际接口提交一个存在和一个缺失视频，返回 `404` 和准确的 `missingVideoIds`；事务测试另外证明任何写入/提交失败都会整体回滚。
5. 手机视口 390×844 检查：页面 scrollWidth=390，无横向溢出，批量工具栏自动换行。
6. 切换隔离环境的无限滚动：选中第一张卡片后滚动，DOM 确认该卡片被虚拟列表卸载；滚回后复选框仍选中。全选控件明确显示当前 4 个结果。
7. 浏览器检查结束时控制台 0 errors / 0 warnings。操作截图位于 [桌面视图](assets/issue514-desktop.png) 和 [手机视图](assets/issue514-mobile.png)。

### 边界与后续

- 派生 NFO/source JSON 队列保持第 6.4 节说明的尽力而为语义，不提供重启后的持久完成保证。
- 新文案中英文完整；其他语言的主要按钮/选择数量已本地化，说明与错误提示暂使用英文，均有对应键。
- 设计与两张截图随 PR 保存；原始调试日志及临时数据不纳入 PR。

## 13. PR 审查修复（2026-10-31）

| 审查意见 | 修复与回归 |
| --- | --- |
| 管理页批量标签弹窗缺少已有标签建议 | 从 `useVideo()` 读取 `availableTags` 并传入批量工具栏；新增管理页交互测试，实际选择目录标签并验证只发送一次批量请求 |
| 导出队列把库读取失败视为空库 | 使用 `getVideosStrict()`；新增读取失败日志、无错误导出及同 revision 后续批次恢复测试，并保留独立的导出写入失败测试 |

本轮验证：前端管理表格与批量工具栏 23 项测试、后端导出队列 7 项测试全部通过；前端 TypeScript/lint、后端 TypeScript 构建及 `git diff --check` 通过。第 12 节的 6,001 项全量测试为最初 PR 提交的记录，本轮按两个修改路径运行针对性回归。

## 14. 单视频导出异常隔离（2026-10-31）

PR 新审查意见指出，队列层遇到单个同步异常时会清空其余 ID。本轮为每个视频增加独立异常处理，日志包含视频 ID；同一分段的剩余视频和后续分段继续执行，每段仍最多尝试 10 个视频。底层已有的常规文件异常处理保持不变，队列层额外隔离向外抛出的异常。共享快照读取失败继续走独立的整批错误路径。

回归测试在 500 个视频中分别让第 1、10、11 和 500 项失败，验证其余 499 项按顺序完成、只记录一次对应错误、快照仅读取一次且定时任务全部结束。导出队列全部 10 项测试、后端 TypeScript 构建及 `git diff --check` 通过。

## 15. 响应丢失后的缓存核实与全量回归（2026-10-31）

PR 剩余意见为“服务端已提交但 POST 响应丢失时不刷新缓存”。`onError` 现在依据 mutation 的原始 operation，尝试刷新对应视频/详情/推荐/标签目录或合集/收藏合集缓存。标签目录变化无法从丢失的响应判断，因此也失效 settings。

刷新成功仍不将未知写入当成明确成功；弹窗保留草稿和候选 UUID，由用户决定是否重试，mutation 不自动重复提交。刷新也失败时保留原始写入错误与草稿。明确的 400 校验错误不触发这种未知写入核实；既有权限错误处理保持原行为。

回归用例使用真实 QueryClient/活跃 QueryObserver，模拟服务端写入成功但丢失响应，验证三个入口操作的查询实际重新读取并更新缓存。另验证重新读取失败、明确校验失败，以及新建合集手动重试保持相同 UUID。管理表格和工具栏共 27 项回归通过。

本轮在同步 `d9934d4f` 的 PR 分支上重新安装后端 lockfile 依赖并完成全量验证：

| 检查 | 结果 |
| --- | --- |
| 后端全量测试 | 257 个文件，3,750 项通过 |
| 前端全量测试 | 208 个文件，2,260 项通过 |
| 前端 typecheck / lint / build | 全部通过 |
| 后端 TypeScript 构建 | 通过 |
| `git diff --check` | 通过 |

本轮合计 6,010 项测试通过；前面章节保留各次提交当时的验证记录。

## 16. 成功写入后的刷新失败测试加强（2026-10-31）

CodeRabbit 补充建议指出，原测试直接 mock `invalidateQueries` 抛错，无法防止遗漏 `throwOnError: true` 的回归。现改为通过活跃 QueryObserver 的实际查询抛出网络错误，验证已成功写入的弹窗关闭、只发送一次 POST、保留旧缓存并记录查询错误，同时显示“已保存但刷新失败”警告。

本轮仅加强测试，产品实现未变；工具栏 13 项测试、前端 typecheck/lint 及 `git diff --check` 通过。第 15 节全量 6,010 项验证记录保留。
