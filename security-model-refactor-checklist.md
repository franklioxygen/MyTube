# MyTube 非 TCB 安全模型改造清单（Markdown）

> 前提：`root`/Docker daemon 永远是 TCB。这里的改造目标是把 **App Admin** 从“系统管理员”降级为“仅业务管理员”，不再拥有宿主/容器命令执行边界。

## 1. 安全目标与边界定义（必须先做）
- [x] 明确三类角色：`Platform Operator (TCB)`、`Security Operator (受控高权限)`、`App Admin (非 TCB)`。
- [x] 在文档中写清楚“应用安全边界”：App Admin 不能直接触达 OS 命令执行面、容器控制面、宿主文件系统。
- [x] 为当前功能做边界标注：`hooks`、`yt-dlp 自定义配置`、`mountDirectories`、`cloudflared` 都属于高风险控制面。
- [x] 新增安全模式开关并计划默认值：`SECURITY_MODEL=strict`。新安装默认 strict；升级实例按第 11 节兼容窗口短期过渡 `legacy`。
- [x] `SECURITY_MODEL` 采用 fail-closed：生产环境下缺失或非法取值时拒绝启动，禁止隐式回落到 `legacy`。

受影响文件：
- [SECURITY.md](/Users/franklioxygen/Projects/mytube/SECURITY.md)
- [README.md](/Users/franklioxygen/Projects/mytube/README.md)
- [README-zh.md](/Users/franklioxygen/Projects/mytube/README-zh.md)
- [backend/.env.example](/Users/franklioxygen/Projects/mytube/backend/.env.example)
- [securityModel.ts](/Users/franklioxygen/Projects/mytube/backend/src/config/securityModel.ts)

验收标准：
- [x] 文档里有清晰的“谁是 TCB、谁不是”定义。
- [x] 新安装默认进入 strict，不再是“默认开放”。
- [x] 升级实例的兼容窗口和切换节奏在第 11 节有明确定义。
- [x] 生产环境中 `SECURITY_MODEL` 缺失/非法会启动失败（fail-closed）。
- [x] 实施记录（2026-03-06）：补齐 `SECURITY.md` 角色与边界定义（TCB/非 TCB、四类高风险控制面）、在中英文 README 写明 `strict/legacy` 默认策略与迁移窗口、将 `backend/.env.example` 默认改为 `SECURITY_MODEL=strict`；后端 `securityModel` 维持生产 fail-closed 校验。验证通过：`npm --prefix backend run test -- src/config/__tests__/securityModel.test.ts`。

---

## 2. 立即止血（P0，先把明显高危面关掉）
- [x] strict 模式下禁用 Task Hooks 上传/执行。
- [x] strict 模式下禁用任意 `ytDlpConfig` 文本透传。
- [x] strict 模式下禁止通过 API 写入 `mountDirectories`。
- [x] strict 模式下禁用应用内启动/重启 `cloudflared`（改为平台层管理）。
- [x] strict 首次启用时执行历史高危配置迁移清洗：禁用旧 hooks、拒绝并标记非白名单 `ytDlpConfig`、冻结 `mountDirectories` API 写入并输出迁移日志。

受影响文件：
- [hookController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/hookController.ts)
- [hookService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/hookService.ts)
- [settingsController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/settingsController.ts)
- [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/settings.ts)
- [scanController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/scanController.ts)
- [cloudRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/server/cloudRoutes.ts)
- [strictSecurityMigrationService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/strictSecurityMigrationService.ts)
- [HookSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/HookSettings.tsx)
- [YtDlpSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/YtDlpSettings.tsx)
- [CloudflareSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/CloudflareSettings.tsx)
- [SettingsPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/SettingsPage.tsx)

验收标准：
- [x] strict 下，以上四类入口均返回明确的 `403/feature disabled`。
- [x] 相关前端设置项显示只读或隐藏。
- [x] strict 开启后历史高危配置不会继续生效，且迁移日志可追溯。

---

## 3. 认证与授权模型重构（P1）
- [x] 取消“`loginEnabled=false` 时放开所有写操作”的行为。
- [x] 新增“首次安装引导（bootstrap）”流程：仅首次创建管理员，完成后所有写接口必须认证。
- [x] bootstrap 端点一次性生效：首个管理员创建成功后立即失效，后续请求返回 `403/409`。
- [x] bootstrap 管理员创建流程必须并发安全（事务/锁），并发请求最多成功一次。
- [x] 公共端点白名单收敛为最小集合（仅登录探测/登录挑战），不含敏感写操作。
- [x] `passkeys/register` 和 `passkeys/delete` 改为仅管理员可用，不再公开。
- [x] `reset-password` 改为受控流程（必须已认证管理员，或一次性恢复 token；token 需短 TTL（建议 `<=15m`）、哈希存储、单次消费、速率限制（建议按账号/IP）与审计）。

受影响文件：
- [roleBasedAuthMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedAuthMiddleware.ts)
- [roleBasedSettingsMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedSettingsMiddleware.ts)
- [apiRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/server/apiRoutes.ts)
- [settingsRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/routes/settingsRoutes.ts)
- [passwordController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passwordController.ts)
- [passkeyController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passkeyController.ts)
- [passwordService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/passwordService.ts)
- [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/settings.ts)
- [LoginPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/LoginPage.tsx)
- [AuthContext.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/contexts/AuthContext.tsx)

验收标准：
- [x] 未认证用户无法调用任何写 API（即使首次安装后）。
- [x] bootstrap 首次成功后不可重复执行，并发竞态下最多创建一个管理员。
- [x] `passkeys/register` 未认证访问返回 `401/403`。
- [x] `reset-password` 不再是公开可调用端点。
- [x] 恢复 token 过期/重放/超限均失败并产生审计记录。
- [x] 恢复 token 策略具备明确参数：TTL、单次消费、按账号/IP 限速阈值。
- [x] 实施记录（2026-03-06）：`roleBasedAuthMiddleware` 与 `roleBasedSettingsMiddleware` 统一改为“未认证写请求默认 401 拒绝”，不再因 `loginEnabled=false` 放开写接口；仍仅保留登录探针/挑战、bootstrap（strict）与 recovery token 路径等公共认证端点放行。验证通过：`npm --prefix backend run test -- src/__tests__/middleware/roleBasedAuthMiddleware.test.ts src/__tests__/middleware/roleBasedSettingsMiddleware.test.ts src/__tests__/server/strictSecurity.integration.test.ts`。
- [x] 实施记录（2026-03-06，补充）：`bootstrapAdminPassword` 改为调用存储层事务化 `tryCompleteBootstrapWithAdminPassword`（密码槽位原子抢占 + `bootstrapCompleted/loginEnabled` 原子写入），并保留进程内 `bootstrapInProgress` 锁，确保并发请求最多一次成功；`passkeyController` 对 `passkeys/register`、`passkeys/register/verify`、`passkeys/delete` 增加管理员强制校验；`reset-password` 与 `reset-password/recovery-token` 全路径补充审计事件（签发、失败、限流、成功）。恢复 token 策略参数：`TTL=15m`、单次消费、`5次/15m` 限速、哈希存储（SHA-256）。验证通过：`npm --prefix backend run test -- src/__tests__/controllers/passkeyController.test.ts src/__tests__/services/passwordService.test.ts src/__tests__/controllers/passwordController.test.ts src/services/storageService/__tests__/settings.test.ts src/__tests__/server/strictSecurity.integration.test.ts src/__tests__/middleware/roleBasedAuthMiddleware.test.ts src/__tests__/middleware/roleBasedSettingsMiddleware.test.ts`、`npm --prefix backend run build`。
- [x] 实施记录（2026-03-07，审查修复）：移除 `reset-password` 对 recovery token query string 的接受路径；检测到 `?recoveryToken=` 时返回 `400/QUERY_TOKEN_NOT_ALLOWED` 并写审计，要求改用 `x-mytube-recovery-token` header 或 request body。`passwordController`、`passkeyController` 与 `securityAuditService` 统一改用受信代理 client IP helper，避免直接信任 `x-forwarded-for`，同时保留 `req.ip` fallback 兼容非代理/单测场景。验证通过：`npm --prefix backend run test -- src/__tests__/controllers/passwordController.test.ts src/__tests__/controllers/passkeyController.test.ts src/__tests__/services/securityAuditService.test.ts src/__tests__/services/securityAuditService.persistence.test.ts`、`npm --prefix backend run build`。
- [x] 实施记录（2026-03-07，legacy 兼容恢复）：针对 Docker `SECURITY_MODEL=legacy` 升级实例的回归，恢复 [roleBasedAuthMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedAuthMiddleware.ts) 与 [roleBasedSettingsMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedSettingsMiddleware.ts) 在 `loginEnabled=false` 时的历史兼容语义：仅在 `legacy` 且 `isLoginRequired() === false` 时允许匿名读写，保证旧部署仍可在无登录模式下提交下载、保存 settings、设置首个密码并完成迁移；`strict` 模式及所有显式登录场景继续保持未认证写拒绝。同步更新 [documents/en/security-breaking-changes.md](/Users/franklioxygen/Projects/mytube/documents/en/security-breaking-changes.md)、[documents/zh/security-breaking-changes.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-breaking-changes.md)、[documents/en/security-migration-plan.md](/Users/franklioxygen/Projects/mytube/documents/en/security-migration-plan.md)、[documents/zh/security-migration-plan.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-migration-plan.md) 的 legacy 兼容说明。验证通过：`npm --prefix backend run test -- src/__tests__/middleware/roleBasedAuthMiddleware.test.ts src/__tests__/middleware/roleBasedSettingsMiddleware.test.ts`、`npm --prefix backend run build`。

---

## 4. 命令执行面重构（P1-P2）
- [x] 删除 `bash` 脚本执行路径：`execPromise("bash ...")`。
- [x] 用“声明式任务类型”替代任意 shell：例如 `notify_webhook`、`move_file`、`transcode_profile_x`。
- [x] 所有可执行动作都走固定参数结构，禁止自由文本命令。
- [x] 保留 hooks 能力时，改为“事件 -> 队列消息 -> 受限执行器”，而不是直接在 API 进程执行。

受影响文件：
- [hookService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/hookService.ts)
- [hookController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/hookController.ts)
- [downloadManager.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/downloadManager.ts)
- [HookSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/HookSettings.tsx)
- [hooks-guide.md](/Users/franklioxygen/Projects/mytube/documents/en/hooks-guide.md)
- [hooks-guide.md](/Users/franklioxygen/Projects/mytube/documents/zh/hooks-guide.md)

验收标准：
- [x] 代码中不再存在 `bash "<user-provided-script>"` 路径。
- [x] 即使 App Admin 被盗，也无法注入任意系统命令。
- [x] 实施记录（2026-03-07，审查修复补充）：新增共享 [webhookExecutor.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/webhookExecutor.ts)，由 [hookService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/hookService.ts) 与 [hookWorker.ts](/Users/franklioxygen/Projects/mytube/backend/src/workers/hookWorker.ts) 共用同一套 `notify_webhook` 校验与执行逻辑，统一禁用 header、模板渲染与超时策略，消除 service/worker 逻辑漂移；同时为上传校验补充“禁止 `Content-Length` 等受控 header”回归测试。补充说明：[strictSecurity.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/strictSecurity.ts) 明确记录 strict 当前对高风险控制面采用全局 deny policy；[docker-compose.yml](/Users/franklioxygen/Projects/mytube/docker-compose.yml) 与 [docker-compose.host-network.yml](/Users/franklioxygen/Projects/mytube/docker-compose.host-network.yml) 移除 frontend 对 `hook-worker` 的非必要 `depends_on`。验证通过：`npm --prefix backend run test -- src/services/__tests__/hookService.test.ts src/__tests__/controllers/hookController.test.ts`、`npm --prefix backend run build`、`docker compose config`、`docker compose -f docker-compose.host-network.yml config`。

---

## 5. `yt-dlp` 配置能力收敛（P2）
- [x] 将 `ytDlpConfig` 从自由文本改为结构化字段（枚举 + 类型校验）。
- [x] 只允许网络相关和质量相关安全参数（allowlist）。
- [x] 拒绝高风险参数：`exec/exec-before-download/exec-after-download`、任意后处理命令、外部配置文件注入相关选项。
- [x] 入库前做 schema 校验，出库后再做一次运行时校验。
- [x] 记录“被拒绝参数审计日志”。
- [x] 对历史 `ytDlpConfig` 执行迁移清洗：非白名单参数自动删除或标记失效，并输出迁移报告。

受影响文件：
- [ytDlpUtils.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/ytDlpUtils.ts)
- [ytDlpSafeConfig.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/ytDlpSafeConfig.ts)
- [ytDlpSafeConfigMigrationService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/ytDlpSafeConfigMigrationService.ts)
- [ytdlpConfig.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/downloaders/ytdlp/ytdlpConfig.ts)
- [settingsValidationService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/settingsValidationService.ts)
- [settingsController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/settingsController.ts)
- [YtDlpSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/YtDlpSettings.tsx)
- [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/settings.ts)
- [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/types/settings.ts)
- [types.ts](/Users/franklioxygen/Projects/mytube/frontend/src/types.ts)
- [SettingsPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/SettingsPage.tsx)

验收标准：
- [x] 非白名单参数无法保存、无法执行。
- [x] 单元测试覆盖“危险参数拒绝路径”。
- [x] 升级后历史危险参数不会继续执行，且有可追溯迁移记录。

---

## 6. 文件系统与目录扫描边界（P2）
- [x] `scan-mount-directories` 从“用户输入目录”改为“平台预配置目录 ID”。
- [x] App Admin 只能选用平台已批准的挂载目录，不能提交任意绝对路径。
- [x] `serveMountVideo` 增加“必须在允许目录集合内”的二次校验。
- [x] 将 `mountDirectories` 从普通设置项剥离到平台配置（环境变量/只读配置文件）。

受影响文件：
- [mountDirectories.ts](/Users/franklioxygen/Projects/mytube/backend/src/config/mountDirectories.ts)
- [scanController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/scanController.ts)
- [videoController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/videoController.ts)
- [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/settings.ts)
- [settingsValidationService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/settingsValidationService.ts)
- [settingsController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/settingsController.ts)
- [SettingsPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/SettingsPage.tsx)
- [types.ts](/Users/franklioxygen/Projects/mytube/frontend/src/types.ts)
- [useSettingsMutations.ts](/Users/franklioxygen/Projects/mytube/frontend/src/hooks/useSettingsMutations.ts)
- [backend/.env.example](/Users/franklioxygen/Projects/mytube/backend/.env.example)

验收标准：
- [x] App Admin 无法通过 API 新增任意宿主目录。
- [x] mount 文件流只允许来自白名单根目录。

---

## 7. 会话与密钥管理（P2）
- [x] 生产环境强制 `JWT_SECRET` 存在，缺失则拒绝启动。
- [x] 会话从纯内存 map 改为可撤销的持久会话存储（含过期、轮换、撤销）。
- [x] 登录成功后加审计字段（IP、UA、时间、session id 哈希）。
- [x] 移除/修正文案中弱默认口令暗示（如“Default password: 123”）。

受影响文件：
- [authService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/authService.ts)
- [server.ts](/Users/franklioxygen/Projects/mytube/backend/src/server.ts)
- [passwordController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passwordController.ts)
- [passkeyController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passkeyController.ts)
- [schema.ts](/Users/franklioxygen/Projects/mytube/backend/src/db/schema.ts)
- [initialization.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/initialization.ts)
- [LoginPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/LoginPage.tsx)
- [en.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/en.ts)
- [zh.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/zh.ts)
- [de.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/de.ts)
- [ru.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/ru.ts)
- [pt.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/pt.ts)
- [fr.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/fr.ts)
- [es.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/es.ts)
- [ar.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/ar.ts)
- [ja.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/ja.ts)
- [ko.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/ko.ts)

验收标准：
- [x] 未配置密钥无法在生产启动。
- [x] 会话可主动失效（登出所有设备）。
- [x] 实施记录（2026-03-06）：`authService` 增加 `assertJwtSecretConfiguration` 并在 `server` 启动阶段强制 fail-closed；会话从内存 `Map` 迁移到 `SQLite auth_sessions`（过期清理、登录轮换、单会话撤销、按角色登出全部会话）；登录成功写入结构化审计字段（IP、UA、时间、session id hash）；`/settings/logout` 支持 `allDevices=true` 主动失效全部设备；多语言文案移除“默认密码 123”暗示。验证通过：`npm --prefix backend run test -- src/__tests__/services/authService.test.ts src/__tests__/controllers/passwordController.test.ts src/__tests__/controllers/passkeyController.test.ts src/__tests__/middleware/authMiddleware.test.ts src/services/storageService/__tests__/initialization.test.ts`、`npm --prefix backend run build`、`npm --prefix frontend run build`。

---

## 8. 运行时隔离（P3）
- [x] 后端容器改为非 root 用户运行。
- [x] 启用只读根文件系统，数据目录单独可写挂载。
- [x] `no-new-privileges`、capabilities 最小化、`pids/memory/cpu` 限额。
- [x] 明确禁止挂载 `/var/run/docker.sock` 与宿主敏感路径。
- [x] 将高风险执行任务迁移到“短生命周期 worker 容器”，并应用 seccomp/apparmor。

受影响文件：
- [Dockerfile](/Users/franklioxygen/Projects/mytube/backend/Dockerfile)
- [docker-compose.yml](/Users/franklioxygen/Projects/mytube/docker-compose.yml)
- [docker-compose.host-network.yml](/Users/franklioxygen/Projects/mytube/docker-compose.host-network.yml)
- [hookService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/hookService.ts)
- [hookWorkerQueueService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/hookWorkerQueueService.ts)
- [hookWorker.ts](/Users/franklioxygen/Projects/mytube/backend/src/workers/hookWorker.ts)
- [hookWorkerQueueService.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/__tests__/hookWorkerQueueService.test.ts)

验收标准：
- [x] 容器内 `id -u` 非 0。
- [x] 即使应用被 RCE，也无法直接提升到宿主控制面。
- [x] 实施记录（2026-03-06）：后端镜像改为 `USER node` 运行；`docker-compose` 与 `docker-compose.host-network` 为 backend 增加 `read_only + tmpfs:/tmp + no-new-privileges + cap_drop:ALL + pids/memory/cpu` 限额，并在样例中显式注释禁止挂载 `docker.sock`。
- [x] 实施记录（2026-03-06，补充）：新增 `hook_worker_jobs` 队列与 `hookWorkerQueueService`（入队、租约领取、失败重试/退避、清理、统计），`HookService` 在 `HOOK_EXECUTION_MODE=worker` 下仅入队；新增独立 `hook-worker` 进程（`dist/src/workers/hookWorker.js`）执行 `notify_webhook`，支持 `maxJobsPerProcess + idleExit` 的短生命周期策略。`docker-compose` 与 host-network 变体新增 `hook-worker` 服务并启用默认 seccomp（引擎内置）、`apparmor=docker-default`、`no-new-privileges`、`cap_drop:ALL` 与资源限额。验证通过：`npm --prefix backend run test -- src/services/__tests__/hookWorkerQueueService.test.ts src/services/__tests__/hookService.test.ts src/__tests__/controllers/hookController.test.ts src/__tests__/services/downloadManager.test.ts src/__tests__/services/strictSecurityMigrationService.test.ts src/services/storageService/__tests__/initialization.test.ts`、`npm --prefix backend run build`、`docker compose config`、`docker compose -f docker-compose.host-network.yml config`。
- [x] 实施记录（2026-03-06，运行态补录）：`docker compose run --rm --no-deps backend id -u` 与 `docker compose run --rm --no-deps hook-worker id -u` 均为 `1000`；容器内 `Seccomp: 2`。为兼容 Docker 对 `seccomp=default` 的解析差异，compose 调整为依赖引擎内置 seccomp 默认策略（移除 `seccomp=default` 显式项），并继续保留 `no-new-privileges`、`cap_drop:ALL`、`apparmor=docker-default` 与资源限额配置。补充：当前 Docker 引擎 `SecurityOptions` 为 `seccomp,cgroupns`，未声明 apparmor（如在不支持 apparmor 的宿主上会降级为 seccomp/no-new-privileges/cap_drop 组合）。
- [x] 实施记录（2026-03-07，Docker 部署修复）：为根 [docker-compose.yml](/Users/franklioxygen/Projects/mytube/docker-compose.yml) 与 [docker-compose.host-network.yml](/Users/franklioxygen/Projects/mytube/docker-compose.host-network.yml) 的 backend 服务补充 `SECURITY_MODEL=${SECURITY_MODEL:-strict}` 与必填 `JWT_SECRET` 环境变量约束，避免镜像在 `NODE_ENV=production` 下因缺失配置直接启动失败并让前端统一表现为 `502 Bad Gateway`；同步更新 [backend/.env.example](/Users/franklioxygen/Projects/mytube/backend/.env.example)、[README.md](/Users/franklioxygen/Projects/mytube/README.md)、[README-zh.md](/Users/franklioxygen/Projects/mytube/README-zh.md)、[documents/en/docker-guide.md](/Users/franklioxygen/Projects/mytube/documents/en/docker-guide.md)、[documents/zh/docker-guide.md](/Users/franklioxygen/Projects/mytube/documents/zh/docker-guide.md) 的部署说明与排障指引。验证通过：`JWT_SECRET=test-secret-with-at-least-32-characters docker compose config`、`JWT_SECRET=test-secret-with-at-least-32-characters docker compose -f docker-compose.host-network.yml config`。

---

## 9. 审计、检测、告警（P3）
- [x] 所有高风险操作写入不可抵赖审计日志（谁、何时、来源 IP、参数摘要、结果）。
- [x] 新增告警规则：异常登录、权限拒绝高频、被拒绝危险配置、目录越界尝试。
- [x] 对敏感令牌字段（如 cloud token）统一脱敏日志输出。

受影响文件：
- [logger.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/logger.ts)
- [securityAuditService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/securityAuditService.ts)
- [settingsController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/settingsController.ts)
- [authService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/authService.ts)
- [passwordController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passwordController.ts)
- [passkeyController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passkeyController.ts)
- [roleBasedAuthMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedAuthMiddleware.ts)
- [roleBasedSettingsMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedSettingsMiddleware.ts)
- [videoController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/videoController.ts)
- [schema.ts](/Users/franklioxygen/Projects/mytube/backend/src/db/schema.ts)
- [initialization.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/initialization.ts)

验收标准：
- [x] 安全事件具备可追溯链路。
- [x] 日志中不泄露明文密钥。
- [x] 实施记录（2026-03-06）：新增统一 `recordSecurityAuditEvent`（结构化字段 + sqlite `security_audit_logs` 持久化 + 元数据脱敏）并接入登录成功/失败、会话签发与撤销、鉴权拒绝、危险配置拒绝、目录越界拒绝；新增四类突发告警规则（异常登录、权限拒绝高频、危险配置拒绝高频、路径越界高频）及冷却窗口；`logger.redactSensitive` 补齐 JSON/key-value/query/bearer 多形态敏感字段脱敏。验证通过：`npm --prefix backend run test -- src/__tests__/services/securityAuditService.test.ts src/__tests__/utils/logger.test.ts src/__tests__/controllers/passwordController.test.ts src/__tests__/controllers/passkeyController.test.ts src/__tests__/middleware/roleBasedAuthMiddleware.test.ts src/__tests__/middleware/roleBasedSettingsMiddleware.test.ts src/__tests__/controllers/settingsController.test.ts src/__tests__/controllers/settingsController.extra.test.ts src/__tests__/controllers/videoController.extra.test.ts src/__tests__/services/authService.test.ts`、`npm --prefix backend run build`。
- [x] 实施记录（2026-03-07，审查修复）：`auth_sessions`、`security_audit_logs`、`hook_worker_jobs` 的 SQLite DDL 抽到共享 schema 定义，消除初始化与懒加载之间的双份建表逻辑；启动时新增 `security_audit_logs` 保留期清理（默认 `90` 天）与 `security_alert_windows` stale cleanup（默认 `7` 天）；告警窗口状态落库到 `security_alert_windows`，跨重启保留 burst/cooldown 计数。验证通过：`npm --prefix backend run test -- src/services/storageService/__tests__/initialization.test.ts src/__tests__/services/securityAuditService.test.ts src/__tests__/services/securityAuditService.persistence.test.ts`、`npm --prefix backend run build`。

---

## 10. 测试与 CI 安全闸门（P3）
- [x] 新增中间件回归测试：未认证写接口一律拒绝。
- [x] 新增安全单测：危险 `yt-dlp` 参数拒绝、hooks 禁用策略、mount 白名单校验。
- [x] 新增集成测试：strict 模式端到端权限验证。
- [x] CI 增加安全扫描步骤（SAST/依赖漏洞）并设为阻断。

受影响文件：
- [master.yml](/Users/franklioxygen/Projects/mytube/.github/workflows/master.yml)
- [roleBasedAuthMiddleware.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/middleware/roleBasedAuthMiddleware.test.ts)
- [roleBasedSettingsMiddleware.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/middleware/roleBasedSettingsMiddleware.test.ts)
- [strictSecurity.integration.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/server/strictSecurity.integration.test.ts)
- [security.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/utils/security.test.ts)
- [settings_mass_assignment.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/__tests__/settings_mass_assignment.test.ts)

验收标准：
- [x] 关键安全策略有自动化测试覆盖。
- [x] CI 中任何高危回归会阻断合并。
- [x] 实施记录（2026-03-06）：保留并回归执行中间件/安全单测（`roleBasedAuthMiddleware`、`roleBasedSettingsMiddleware`、`security`、`settings_mass_assignment`）；`master.yml` 新增 backend/frontend 的 `npm audit --audit-level=high --omit=dev` 阻断步骤。为通过高危闸门，后端依赖 `express-rate-limit` 升级到 `^8.3.0` 并确认 `npm audit` 无 high/critical。
- [x] 实施记录（2026-03-06，补充）：新增 strict 端到端权限集成测试（`express + supertest`）覆盖未认证写入拒绝、登录探针/引导端点放行、recovery token 放行与无 token 拒绝、admin/visitor 差异权限。验证通过：`npm --prefix backend run test -- src/__tests__/server/strictSecurity.integration.test.ts src/__tests__/middleware/roleBasedAuthMiddleware.test.ts src/__tests__/middleware/roleBasedSettingsMiddleware.test.ts`。

---

## 11. 发布迁移计划（建议按 3 个版本）
### `vNext`（兼容观察期，目标是“先可见、再收敛”）
- [x] 目标：上线 strict 机制与迁移能力，但避免对已升级实例立即硬破。
- [x] 默认行为：新安装默认 `strict`；升级实例默认保留 `legacy` 并显示风险横幅。
- [x] 实施项：上线 `SECURITY_MODEL` 与 fail-closed 启动校验；上线迁移扫描脚本与迁移报告；上线高风险能力访问告警日志。
- [x] 迁移项：识别并标记历史 hooks、非白名单 `ytDlpConfig`、`mountDirectories` API 写入、应用内 cloudflared 控制面调用。
- [x] 回滚策略：支持版本级回滚；过渡窗口内允许显式设 `SECURITY_MODEL=legacy`（必须记录审计日志）。
- [ ] 阶段退出条件：迁移报告覆盖全部升级实例；高风险实例都有责任人和整改计划；无大面积认证/下载回归。

### `vNext+1`（默认切换期，目标是“默认安全”）
- [x] 目标：升级实例默认切换到 `strict`，将 legacy 改为显式且临时的兼容选项。
- [x] 默认行为：升级实例默认 `strict`；`legacy` 仅在显式开启时生效，并持续显示风险横幅与退场提示。
- [x] 实施项：启用未认证写接口全拒绝；bootstrap 一次性失效与并发原子创建；strict 下禁用 hooks shell、禁用 `ytDlpConfig` 文本透传、禁用 `mountDirectories` API 写入。
- [x] 迁移项：对切换失败实例按迁移报告逐项整改，并沉淀常见失败模式与修复手册。
- [x] 回滚策略：仅允许短时、可审计的 `legacy` 回退（需绑定到期时间和整改工单）。
- [ ] 阶段退出条件：绝大多数实例稳定运行在 strict；legacy 使用率降至可控低位并可追踪。

### `vNext+2`（移除期，目标是“安全边界定型”）
- [x] 目标：移除 `legacy` 与对应高危能力，完成模型定型并简化代码路径。
- [x] 默认行为：仅支持 `strict`；不再支持 `legacy` 配置或回退开关。
- [x] 实施项：删除 legacy 相关代码/配置/文档；移除任意 hook shell 执行路径与自由配置注入能力；同步清理前端入口和 API。
- [x] 迁移项：发布最终替代方案（声明式任务、allowlist 配置、平台级目录白名单）。
- [x] 回滚策略：仅支持版本级整体回滚，不再支持“运行时切回 legacy”。
- [ ] 阶段退出条件：代码中不存在 legacy 分支；安全测试与 CI 闸门全部通过；发布说明明确列出 breaking 项。

### 迁移与回滚手册（跨阶段）
- [x] 提供统一 runbook：覆盖 hooks、`ytDlpConfig`、`mountDirectories`、cloudflared 的迁移前备份、迁移步骤、验证步骤、回滚步骤。
- [x] 提供统一产物模板：迁移报告、失败项清单、回滚记录、剩余风险清单。
- [x] 对每次回滚要求记录：触发原因、影响范围、恢复时间、后续整改负责人。

受影响文件：
- [security-migration-plan.md](/Users/franklioxygen/Projects/mytube/documents/en/security-migration-plan.md)
- [security-migration-plan.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-migration-plan.md)
- [security-migration-runbook.md](/Users/franklioxygen/Projects/mytube/documents/en/security-migration-runbook.md)
- [security-migration-runbook.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-migration-runbook.md)
- [security-migration-templates.md](/Users/franklioxygen/Projects/mytube/documents/en/security-migration-templates.md)
- [security-migration-templates.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-migration-templates.md)
- [security-rollout-gates.md](/Users/franklioxygen/Projects/mytube/documents/en/security-rollout-gates.md)
- [security-rollout-gates.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-rollout-gates.md)
- [security-migration-scan.ts](/Users/franklioxygen/Projects/mytube/backend/scripts/security-migration-scan.ts)
- [securityMigrationScanService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/securityMigrationScanService.ts)

验收标准：
- [x] 升级路径可回滚、有迁移说明、有兼容窗口。
- [x] 迁移执行产出报告（变更摘要、失败项、回滚指引）且可归档。
- [x] 用户明确知道哪些能力因安全边界变化被移除或替代。
- [x] 实施记录（2026-03-06）：新增中英文化发布迁移计划、runbook 与回滚门禁文档，覆盖 3 阶段（`vNext`/`vNext+1`/`vNext+2`）目标、默认行为、回滚策略、退出条件；新增可归档产物模板（迁移报告、失败项、回滚记录、剩余风险）。同时新增 `security-migration:scan` 脚本（dry-run）与报告输出格式，支持 `--assert-clean` 阻断高风险切换。相关文件：`documents/*/security-migration-plan.md`、`documents/*/security-migration-runbook.md`、`documents/*/security-rollout-gates.md`、`documents/*/security-migration-templates.md`、`backend/scripts/security-migration-scan.ts`、`backend/src/services/securityMigrationScanService.ts`。

---

## 12. API 与配置 Breaking 变更矩阵（对外契约）
- [x] 输出“公开接口/配置变更清单”：路径、方法、旧行为、新行为、生效阶段、替代方案。
- [x] 统一错误语义：未认证返回 `401`，鉴权失败返回 `403`，能力关闭返回 `403/feature disabled`。
- [x] 每个 breaking 项提供“客户端改造示例”与“最晚迁移版本”。
- [x] 在发布说明中明确“是否可回滚、回滚影响、兼容窗口截止版本”。

契约明细（必须纳入发布说明）：
| 变更项 | 旧行为 | 新行为 | 生效阶段 | 替代方案 |
| --- | --- | --- | --- | --- |
| 未认证写接口 | `loginEnabled=false` 时可能放行 | 一律拒绝（`401/403`） | `vNext+1` 默认生效，`vNext+2` 强制 | 完成管理员认证后调用 |
| `passkeys/register` | 公开或弱保护 | 仅管理员可调用 | `vNext+1` | 登录后通过管理员会话调用 |
| `reset-password` | 公开端点可触达 | 仅管理员或一次性恢复 token 流程 | `vNext+1` | 使用受控恢复流程 |
| hooks shell 执行 | 可执行脚本/命令 | strict 下禁用任意 shell | `vNext+1` 默认，`vNext+2` 移除 legacy | 声明式任务执行器 |
| `ytDlpConfig` 自由文本 | 自由透传参数 | 结构化 allowlist | `vNext+1` 默认，`vNext+2` 强制 | 配置枚举字段 |
| `mountDirectories` API 写入 | 可写入任意路径 | 仅平台预配置目录 ID | `vNext+1` 默认，`vNext+2` 强制 | 平台侧配置白名单目录 |

受影响文件：
- [README.md](/Users/franklioxygen/Projects/mytube/README.md)
- [README-zh.md](/Users/franklioxygen/Projects/mytube/README-zh.md)
- [SECURITY.md](/Users/franklioxygen/Projects/mytube/SECURITY.md)
- [security-breaking-changes.md](/Users/franklioxygen/Projects/mytube/documents/en/security-breaking-changes.md)
- [security-breaking-changes.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-breaking-changes.md)
- [apiRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/server/apiRoutes.ts)
- [settingsRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/routes/settingsRoutes.ts)

验收标准：
- [x] 所有 breaking 项均有“旧行为/新行为/生效阶段/替代方案”四元组说明。
- [x] 发布说明与代码实现返回码一致，不出现 `401/403` 语义混用。
- [x] 升级用户可据文档完成改造，无需阅读源码推断行为。
- [x] 实施记录（2026-03-06）：新增中英文化 Breaking 变更矩阵（含错误语义、迁移示例、最晚迁移阶段、回滚窗口）。返回码语义通过 strict 集成与中间件回归验证：`npm --prefix backend run test -- src/__tests__/server/strictSecurity.integration.test.ts src/__tests__/middleware/roleBasedAuthMiddleware.test.ts src/__tests__/middleware/roleBasedSettingsMiddleware.test.ts`。相关文件：`documents/*/security-breaking-changes.md`、`README.md`、`README-zh.md`、`SECURITY.md`。

---

## 13. 单实例迁移 Runbook（执行步骤）
- [x] 步骤 1：迁移前快照（数据库、设置文件、关键环境变量）并记录快照 ID。
- [x] 步骤 2：执行迁移扫描（dry-run），输出风险清单：hooks、危险 `ytDlpConfig`、`mountDirectories` 非法路径、公开认证端点依赖。
- [x] 步骤 3：按风险清单整改并复扫，确保 high-risk 项为 0。
- [x] 步骤 4：按发布决策切换 canary 或一次全量到 strict，并在窗口内验证登录、下载、扫描、播放链路。
- [x] 步骤 5：完成目标范围切换（canary 扩量或全量直切），归档迁移报告与审计日志。
- [x] 步骤 6：若触发回滚阈值，按手册执行版本级回滚或短时 `legacy` 回退，并记录原因与整改计划。
- [x] 要求：迁移脚本必须幂等（重复执行不会放大副作用）。

受影响文件：
- [security-model-refactor-checklist.md](/Users/franklioxygen/Projects/mytube/security-model-refactor-checklist.md)
- [README.md](/Users/franklioxygen/Projects/mytube/README.md)
- [README-zh.md](/Users/franklioxygen/Projects/mytube/README-zh.md)
- [security-migration-scan.ts](/Users/franklioxygen/Projects/mytube/backend/scripts/security-migration-scan.ts)
- [securityMigrationScanService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/securityMigrationScanService.ts)
- [securityMigrationScanService.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/services/securityMigrationScanService.test.ts)
- [security-migration-runbook.md](/Users/franklioxygen/Projects/mytube/documents/en/security-migration-runbook.md)
- [security-migration-runbook.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-migration-runbook.md)
- [security-migration-templates.md](/Users/franklioxygen/Projects/mytube/documents/en/security-migration-templates.md)
- [security-migration-templates.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-migration-templates.md)

验收标准：
- [x] Runbook 在测试环境完成至少一次端到端演练并有记录。
- [x] dry-run 与正式迁移产物格式一致，可自动归档和比对。
- [ ] 回滚演练至少完成一次，且可在目标窗口内恢复服务。
- [x] 实施记录（2026-03-06）：新增 `security-migration:scan` dry-run 扫描脚本与统一报告格式（JSON/Markdown），并在本地测试环境执行演练：`npm --prefix backend run security-migration:scan -- --format markdown --out data/security-migration-report-pre.md --security-model strict`、`npm --prefix backend run security-migration:scan -- --format json --out data/security-migration-report-pre.json --security-model strict`、`npm --prefix backend run security-migration:scan -- --format json --out data/security-migration-report.json --assert-clean`（按预期在存在 high-risk 时阻断）。相关文件：`backend/scripts/security-migration-scan.ts`、`backend/src/services/securityMigrationScanService.ts`、`backend/src/__tests__/services/securityMigrationScanService.test.ts`、`documents/*/security-migration-runbook.md`、`documents/*/security-migration-templates.md`。
- [x] 实施记录（2026-03-06，发布决策补充）：按操作人策略采用“一次全量迁移（无 canary）”，平台验证由操作人在各平台自行执行；runbook 与灰度门禁文档已补充“全量直切豁免”前置条件（`--assert-clean`、回滚预案、审批留痕）。

---

## 14. 灰度发布与回滚阈值（强制门禁）
- [x] 灰度策略：按实例/租户分批推进（建议 10% -> 30% -> 60% -> 100%），每一批次至少观察一个完整业务高峰周期。
- [x] 强制监控项：登录成功率、下载任务成功率、`5xx` 比例、权限拒绝计数、被拒绝危险配置计数。
- [x] 回滚硬阈值（满足任一即暂停并回滚当前批次）：
- [x] `5xx` 比例连续 15 分钟高于基线 + 1%。
- [x] 登录成功率连续 15 分钟低于基线 2% 以上。
- [x] 下载任务失败率连续 30 分钟高于基线 5% 以上。
- [x] 出现无法登录管理员且无法通过受控恢复流程修复的阻断故障。
- [x] 说明：权限拒绝计数上升属于预期信号，单独出现不触发回滚，需结合业务可用性指标判断。

受影响文件：
- [master.yml](/Users/franklioxygen/Projects/mytube/.github/workflows/master.yml)
- [logger.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/logger.ts)
- [authService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/authService.ts)
- [security-rollout-gates.md](/Users/franklioxygen/Projects/mytube/documents/en/security-rollout-gates.md)
- [security-rollout-gates.md](/Users/franklioxygen/Projects/mytube/documents/zh/security-rollout-gates.md)

验收标准：
- [ ] 发布前存在可视化仪表盘与告警规则，覆盖上述全部指标。
- [ ] 每次灰度批次都有开始时间、结束时间、指标快照、是否放量/回滚决策记录。
- [ ] 回滚阈值被自动化检查或人工值守清单明确执行，不依赖临场判断。
- [x] 实施记录（2026-03-06）：新增中英文化灰度发布与回滚阈值门禁文档，固定批次策略（10%/30%/60%/100%）、强制指标与硬回滚阈值，补充批次决策记录字段与执行规则。相关文件：`documents/*/security-rollout-gates.md`。
- [x] 实施记录（2026-03-06，补充）：新增“全量直切豁免（不做 canary）”条款，要求直切前通过 `--assert-clean`、具备回滚预案与审批记录，确保在非灰度策略下仍有强制门禁。

---

## 15. `PR-1 ~ PR-8` 可执行任务单（建议合并顺序）
- [ ] 总体要求：每个 PR 必须包含代码变更、自动化测试、迁移说明、回滚步骤四件套。
- [ ] 合并策略：高风险 PR 必须“先灰度后全量”；任一 PR 未满足验收标准不得进入下一 PR。

### PR-1：安全模式底座与 fail-closed
- [x] 目标：落地 `SECURITY_MODEL` 解析与生产 fail-closed 启动策略；统一 strict/legacy 文档口径。
- [x] 改动文件：[SECURITY.md](/Users/franklioxygen/Projects/mytube/SECURITY.md), [README.md](/Users/franklioxygen/Projects/mytube/README.md), [README-zh.md](/Users/franklioxygen/Projects/mytube/README-zh.md), [securityModel.ts](/Users/franklioxygen/Projects/mytube/backend/src/config/securityModel.ts), [server.ts](/Users/franklioxygen/Projects/mytube/backend/src/server.ts), [securityModel.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/config/__tests__/securityModel.test.ts), [backend/.env.example](/Users/franklioxygen/Projects/mytube/backend/.env.example)
- [x] 测试点：`SECURITY_MODEL` 为 strict/legacy/非法值时行为符合预期；生产环境缺失配置拒绝启动。
- [x] 回滚点：短期可显式设置 `SECURITY_MODEL=legacy`；若启动异常可版本级回滚到上一稳定版。
- [x] 实施记录（2026-03-06）：已完成代码与文档落地；已执行 `vitest` 回归（`securityModel` + 路由/中间件相关用例）并通过。

### PR-2：认证写接口封堵与 bootstrap 一次性
- [x] 目标：彻底移除“未认证 + 写接口”路径；完成 bootstrap 单次创建与并发安全。（strict 生效，legacy 保留短期兼容）
- [x] 改动文件：[roleBasedAuthMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedAuthMiddleware.ts), [roleBasedSettingsMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedSettingsMiddleware.ts), [apiRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/server/apiRoutes.ts), [settingsRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/routes/settingsRoutes.ts), [passwordController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passwordController.ts), [passwordService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/passwordService.ts), [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/settings.ts), [LoginPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/LoginPage.tsx), [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/types/settings.ts)
- [x] 测试点：所有写 API 未认证均 `401/403`；bootstrap 首次成功后二次返回 `403/409`；并发创建最多成功一次。
- [x] 回滚点：仅允许版本级回滚；不得回滚成“未认证可写”的旧行为。
- [x] 实施记录（2026-03-06）：新增 `/api/settings/bootstrap` 一次性初始化接口；strict 下未认证写接口默认拒绝；登录页支持 bootstrap 初始化流程；后端与登录页相关测试已通过。

### PR-3：`passkeys` 与 `reset-password` 受控化
- [x] 目标：关闭公开注册/删除 passkey；`reset-password` 收敛到管理员会话或一次性恢复 token。
- [x] 改动文件：[passwordController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passwordController.ts), [passwordService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/passwordService.ts), [roleBasedAuthMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedAuthMiddleware.ts), [roleBasedSettingsMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedSettingsMiddleware.ts), [settingsRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/routes/settingsRoutes.ts), [apiRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/server/apiRoutes.ts), [settingsController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/settingsController.ts), [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/settings.ts), [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/types/settings.ts)
- [x] 测试点：未认证访问 `passkeys/register` 失败；恢复 token 满足 TTL、单次消费、限速、审计要求。
- [x] 回滚点：可回滚到 PR-2，但必须保留已生成审计记录与恢复流程日志。
- [x] 实施记录（2026-03-06）：新增 `POST /api/settings/reset-password/recovery-token`（管理员签发一次性 token）；`reset-password` 支持管理员会话或恢复 token；恢复 token 采用 `TTL=15m`、单次消费、`5次/15m` 限速；公开 `passkeys/register` 与公开 `reset-password` 在 strict 下均被拦截。

### PR-4：strict 模式下高危入口止血（P0）
- [x] 目标：strict 下禁用 hooks 上传/执行、`ytDlpConfig` 文本透传、`mountDirectories` API 写入、应用内 cloudflared 控制。
- [x] 改动文件：[hookController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/hookController.ts), [hookService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/hookService.ts), [settingsController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/settingsController.ts), [scanController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/scanController.ts), [cloudRoutes.ts](/Users/franklioxygen/Projects/mytube/backend/src/server/cloudRoutes.ts), [strictSecurityMigrationService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/strictSecurityMigrationService.ts), [strictSecurity.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/strictSecurity.ts), [ytDlpUtils.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/ytDlpUtils.ts), [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/settings.ts), [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/types/settings.ts), [HookSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/HookSettings.tsx), [YtDlpSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/YtDlpSettings.tsx), [CloudflareSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/CloudflareSettings.tsx), [SettingsPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/SettingsPage.tsx)
- [x] 测试点：strict 下四类入口全部 `403/feature disabled`；前端设置项只读或隐藏。
- [x] 回滚点：灰度失败可临时切回 `SECURITY_MODEL=legacy`，并记录实例范围与截止时间。
- [x] 实施记录（2026-03-06）：新增 strict 特性封禁响应（统一 `403 + feature disabled`）；启动时执行一次性 strict 迁移清洗（禁用历史 hooks、清空 legacy `ytDlpConfig`、停用 cloudflared in-app 控制并记录迁移日志）；前端 settings 对 hooks/yt-dlp/mount/cloudflared 显示只读禁用；后端全量测试（110 文件/1330 用例）与前端构建、相关 settings 组件测试均通过。

### PR-5：`yt-dlp` allowlist 结构化与历史配置迁移
- [x] 目标：将 `ytDlpConfig` 从自由文本改为结构化配置，落地入库/运行时双重校验。
- [x] 改动文件：[ytDlpUtils.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/ytDlpUtils.ts), [ytDlpSafeConfig.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/ytDlpSafeConfig.ts), [ytDlpSafeConfigMigrationService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/ytDlpSafeConfigMigrationService.ts), [settingsValidationService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/settingsValidationService.ts), [settingsController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/settingsController.ts), [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/settings.ts), [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/types/settings.ts), [YtDlpSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/YtDlpSettings.tsx), [SettingsPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/SettingsPage.tsx), [types.ts](/Users/franklioxygen/Projects/mytube/frontend/src/types.ts), [ytDlpSafeConfig.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/utils/ytDlpSafeConfig.test.ts), [ytDlpSafeConfigMigrationService.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/services/ytDlpSafeConfigMigrationService.test.ts), [ytDlpUtils.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/utils/ytDlpUtils.test.ts), [settingsValidationService.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/services/settingsValidationService.test.ts), [YtDlpSettings.test.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/__tests__/YtDlpSettings.test.tsx), [SettingsPage.test.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/__tests__/SettingsPage.test.tsx)
- [x] 测试点：危险参数保存失败且执行失败；历史危险参数迁移后不生效并有迁移报告。
- [x] 回滚点：可回滚代码版本；配置回滚必须使用迁移前快照，不可手工恢复危险参数直通。
- [x] 实施记录（2026-03-06）：新增 `ytDlpSafeConfig` allowlist 结构、运行时 flags 转换与 legacy 文本迁移服务；strict 下拒绝 legacy `ytDlpConfig` 写入并记录拒绝参数日志；前端 `YtDlpSettings` 改为结构化配置表单。验证已通过：`npm --prefix backend run test -- src/__tests__/utils/ytDlpSafeConfig.test.ts src/__tests__/utils/ytDlpUtils.test.ts src/__tests__/services/settingsValidationService.test.ts src/services/storageService/__tests__/settings_mass_assignment.test.ts src/__tests__/services/ytDlpSafeConfigMigrationService.test.ts`、`npm --prefix backend run build`、`npm --prefix frontend run test -- --run src/components/Settings/__tests__/YtDlpSettings.test.tsx src/pages/__tests__/SettingsPage.test.tsx`、`npm --prefix frontend run build`。
- [x] 实施记录（2026-03-07，审查修复）：`parseYtDlpConfig` 返回类型收紧为 `Record<string, unknown>`；`getUserYtDlpConfig` 的安全告警与异常改用 `logger.warn/error`，不再使用 `console.warn/log` 输出 `[SecurityAudit]` 前缀日志。验证通过：`npm --prefix backend run test -- src/__tests__/utils/ytDlpUtils.test.ts`、`npm --prefix backend run build`。

### PR-6：目录扫描与挂载边界收敛
- [x] 目标：`scan-mount-directories` 改为平台目录 ID；视频流与扫描流程双重白名单校验。
- [x] 改动文件：[mountDirectories.ts](/Users/franklioxygen/Projects/mytube/backend/src/config/mountDirectories.ts), [mountDirectories.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/config/__tests__/mountDirectories.test.ts), [scanController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/scanController.ts), [videoController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/videoController.ts), [settings.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/settings.ts), [settingsValidationService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/settingsValidationService.ts), [settingsController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/settingsController.ts), [scanController.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/controllers/scanController.test.ts), [scanController.extra.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/controllers/scanController.extra.test.ts), [videoController.extra.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/controllers/videoController.extra.test.ts), [settingsValidationService.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/services/settingsValidationService.test.ts), [SettingsPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/SettingsPage.tsx), [SettingsPage.test.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/__tests__/SettingsPage.test.tsx), [types.ts](/Users/franklioxygen/Projects/mytube/frontend/src/types.ts), [useSettingsMutations.ts](/Users/franklioxygen/Projects/mytube/frontend/src/hooks/useSettingsMutations.ts), [backend/.env.example](/Users/franklioxygen/Projects/mytube/backend/.env.example)
- [x] 测试点：任意绝对路径注入失败；越界路径访问失败；仅允许平台预配置目录 ID。
- [x] 回滚点：回滚时恢复平台目录配置快照；禁止开放“任意路径输入”作为临时修复。
- [x] 实施记录（2026-03-06）：新增 `PLATFORM_MOUNT_DIRECTORIES` 平台配置与目录 ID 解析；`scan-mount-directories` 改为仅接受 `directoryIds`；`serveMountVideo` 增加白名单根目录二次校验；前端设置页改为勾选平台目录 ID 扫描并移除 `mountDirectories` 文本保存路径。验证通过：`npm --prefix backend run test -- src/config/__tests__/mountDirectories.test.ts src/__tests__/controllers/scanController.test.ts src/__tests__/controllers/scanController.extra.test.ts src/__tests__/controllers/videoController.extra.test.ts src/__tests__/controllers/settingsController.test.ts src/__tests__/controllers/settingsController.extra.test.ts src/__tests__/services/settingsValidationService.test.ts`、`npm --prefix frontend run test -- --run src/pages/__tests__/SettingsPage.test.tsx src/components/Settings/__tests__/YtDlpSettings.test.tsx`、`npm --prefix backend run build`、`npm --prefix frontend run build`。
- [x] 实施记录（2026-03-07，审查修复）：`/settings` 恢复只读兼容字段 `mountDirectories`（由 `PLATFORM_MOUNT_DIRECTORIES` 生成）以降低旧 API 客户端读取断裂风险，但仍保持写入拒绝；前端 patch payload 显式剔除该只读别名，避免误写回服务端。验证通过：`npm --prefix backend run test -- src/__tests__/controllers/settingsController.test.ts src/__tests__/controllers/settingsController.extra.test.ts`、`npm --prefix frontend run build`。

### PR-7：命令执行面重构（移除任意 shell）
- [x] 目标：移除 `execPromise("bash ...")` 路径，改为声明式任务与受限执行器。
- [x] 改动文件：[hookService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/hookService.ts), [hookController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/hookController.ts), [hookService.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/__tests__/hookService.test.ts), [hookController.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/controllers/hookController.test.ts), [downloadManager.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/downloadManager.ts), [downloadManager.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/services/downloadManager.test.ts), [HookSettings.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/components/Settings/HookSettings.tsx), [en.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/en.ts), [zh.ts](/Users/franklioxygen/Projects/mytube/frontend/src/utils/locales/zh.ts), [hooks-guide.md](/Users/franklioxygen/Projects/mytube/documents/en/hooks-guide.md), [hooks-guide.md](/Users/franklioxygen/Projects/mytube/documents/zh/hooks-guide.md), [README.md](/Users/franklioxygen/Projects/mytube/README.md), [README-zh.md](/Users/franklioxygen/Projects/mytube/README-zh.md)
- [x] 测试点：代码扫描不再存在用户可控 shell 执行路径；声明式任务参数做严格 schema 校验。
- [x] 回滚点：仅允许版本级回滚；禁止恢复“用户脚本直接执行”能力。
- [x] 实施记录（2026-03-06）：`HookService` 从 shell 执行改为声明式 JSON 动作执行器（当前支持 `notify_webhook`），移除 `bash` 调用并引入“事件 -> 队列 -> 受限执行器”；`hookController` 改为上传 JSON 定义并做结构化校验；前端 Hook 设置改为上传 `.json`；中英文 Hook 文档改为声明式配置说明。验证通过：`npm --prefix backend run test -- src/services/__tests__/hookService.test.ts src/__tests__/controllers/hookController.test.ts src/__tests__/services/downloadManager.test.ts src/__tests__/services/strictSecurityMigrationService.test.ts`、`npm --prefix frontend run test -- --run src/pages/__tests__/SettingsPage.test.tsx`、`npm --prefix backend run build`、`npm --prefix frontend run build`。
- [x] 实施记录（2026-03-07，审查修复）：legacy `.sh` hook 被忽略时改为“每次检测都 warning + 审计记录”，不再只在单个进程生命周期内首次告警一次，方便升级后持续发现失效 hook。验证通过：`npm --prefix backend run test -- src/services/__tests__/hookService.test.ts`、`npm --prefix backend run build`。

### PR-8：会话/运行时/审计/CI 收口
- [x] 目标：完成会话与密钥治理、容器隔离、审计与告警、CI 安全闸门，形成可发布基线。
- [x] 改动文件：[authService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/authService.ts), [passwordController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passwordController.ts), [passkeyController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/passkeyController.ts), [roleBasedAuthMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedAuthMiddleware.ts), [roleBasedSettingsMiddleware.ts](/Users/franklioxygen/Projects/mytube/backend/src/middleware/roleBasedSettingsMiddleware.ts), [settingsController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/settingsController.ts), [videoController.ts](/Users/franklioxygen/Projects/mytube/backend/src/controllers/videoController.ts), [securityAuditService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/securityAuditService.ts), [schema.ts](/Users/franklioxygen/Projects/mytube/backend/src/db/schema.ts), [initialization.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/initialization.ts), [logger.ts](/Users/franklioxygen/Projects/mytube/backend/src/utils/logger.ts), [LoginPage.tsx](/Users/franklioxygen/Projects/mytube/frontend/src/pages/LoginPage.tsx), [Dockerfile](/Users/franklioxygen/Projects/mytube/backend/Dockerfile), [docker-compose.yml](/Users/franklioxygen/Projects/mytube/docker-compose.yml), [docker-compose.host-network.yml](/Users/franklioxygen/Projects/mytube/docker-compose.host-network.yml), [hookService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/hookService.ts), [hookWorkerQueueService.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/hookWorkerQueueService.ts), [hookWorker.ts](/Users/franklioxygen/Projects/mytube/backend/src/workers/hookWorker.ts), [hookWorkerQueueService.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/__tests__/hookWorkerQueueService.test.ts), [master.yml](/Users/franklioxygen/Projects/mytube/.github/workflows/master.yml), [roleBasedAuthMiddleware.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/middleware/roleBasedAuthMiddleware.test.ts), [roleBasedSettingsMiddleware.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/middleware/roleBasedSettingsMiddleware.test.ts), [strictSecurity.integration.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/server/strictSecurity.integration.test.ts), [securityAuditService.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/services/securityAuditService.test.ts), [logger.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/utils/logger.test.ts), [security.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/__tests__/utils/security.test.ts), [settings_mass_assignment.test.ts](/Users/franklioxygen/Projects/mytube/backend/src/services/storageService/__tests__/settings_mass_assignment.test.ts)
- [x] 测试点：生产缺失 `JWT_SECRET` 启动失败；会话可撤销；容器非 root；CI 安全扫描可阻断高危回归。
- [x] 回滚点：运行时隔离相关问题以版本级回滚处理；禁止通过放宽容器特权作为常态回滚手段。
- [x] 阶段记录（2026-03-06）：已完成会话/密钥治理、登录/鉴权/配置/路径安全审计与告警、敏感字段日志脱敏、strict 模式端到端权限集成测试、容器基础隔离与 CI 高危依赖扫描闸门，并完成第 8 节“短生命周期 worker + seccomp/apparmor”与容器运行态 `id -u` 验证补录。

验收标准：
- [ ] 8 个 PR 均具备独立回滚说明和可复现测试步骤。
- [ ] PR 顺序可直接执行，前置依赖清晰且不会循环阻塞。
- [ ] 任一阶段中断时，系统仍保持“未认证不可写”与“高危面默认关闭”的底线。

---

## 阻断级优先级（先做这 5 个）
- [x] 禁止“未认证 + 写接口”路径（最高优先）。
- [x] 关闭公开 `passkeys/register` 和公开 `reset-password`。
- [x] strict 下禁用 hooks 的 shell 执行。
- [x] strict 下收敛 `ytDlpConfig` 到 allowlist。
- [x] mount 扫描改成平台白名单目录而非用户输入路径。
