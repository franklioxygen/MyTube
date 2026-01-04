# VisitorMode 重构计划

## 概述
`visitorMode` 设置项已被标记为 deprecated。权限控制应完全基于 `userRole`（'admin' | 'visitor'），而不是依赖 settings 中的 `visitorMode` 标志。

## 当前架构分析

### 当前逻辑
1. **Settings 层面**：
   - `visitorMode: boolean` - 控制是否启用访客模式
   - `visitorPassword: string` - 访客账户密码

2. **权限控制逻辑**：
   - 如果 `visitorMode === true` 且 `userRole !== 'admin'` → 限制为只读
   - 两个 middleware 都检查 `visitorMode` 设置

3. **登录逻辑**：
   - 如果 `visitorMode === true` 且密码匹配 `visitorPassword` → 分配 `visitor` role

### 问题
- 权限控制混合了 settings 配置和 user role
- `visitorMode` 设置项是多余的，权限应该完全基于 `userRole`
- 代码复杂度增加，需要同时检查两个条件

## 重构目标

### 新架构
1. **权限控制**：完全基于 `userRole`
   - `userRole === 'visitor'` → 只读权限
   - `userRole === 'admin'` → 完全权限
   - `userRole === null` → 未登录（根据 loginEnabled 决定是否允许访问）

2. **登录逻辑**：
   - 密码匹配 `password` → `admin` role
   - 密码匹配 `visitorPassword` → `visitor` role（不再检查 `visitorMode`）
   - Passkey → `admin` role（保持不变）

3. **Settings**：
   - 移除 `visitorMode` 设置项（deprecated，但保留字段以兼容旧数据）
   - 保留 `visitorPassword`（用于登录获取 visitor role）

## 重构步骤

### Phase 1: Backend 重构

#### 1.1 创建基于 Role 的权限中间件
**文件**: `backend/src/middleware/roleBasedAuthMiddleware.ts` (新建)
- 替换 `visitorModeMiddleware.ts`
- 逻辑：如果 `userRole === 'visitor'`，限制为只读
- 允许 admin 和未登录用户（根据 loginEnabled）的 GET 请求
- 阻止 visitor 的写操作（POST, PUT, DELETE, PATCH）

#### 1.2 更新 Settings 中间件
**文件**: `backend/src/middleware/visitorModeSettingsMiddleware.ts` → 重命名为 `roleBasedSettingsMiddleware.ts`
- 移除对 `visitorMode` 设置的检查
- 基于 `userRole === 'visitor'` 进行权限控制
- 允许 visitor 更新 CloudFlare 设置（如果需要）

#### 1.3 更新密码验证逻辑
**文件**: `backend/src/services/passwordService.ts`
- 移除 `visitorMode` 检查（第111行）
- 如果密码匹配 `visitorPassword`，直接分配 `visitor` role
- 逻辑：`if (mergedSettings.visitorPassword && isVisitorMatch) → visitor role`

#### 1.4 更新 Settings 验证服务
**文件**: `backend/src/services/settingsValidationService.ts`
- 移除 `checkVisitorModeRestrictions` 函数（或重构为基于 role 的检查）
- 移除 `visitorMode` 相关的验证逻辑

#### 1.5 更新 Settings Controller
**文件**: `backend/src/controllers/settingsController.ts`
- 移除 `visitorMode` 相关的检查逻辑（第132-160行）
- 基于 `userRole === 'visitor'` 进行权限控制

#### 1.6 更新 Settings 类型
**文件**: `backend/src/types/settings.ts`
- 标记 `visitorMode` 为 deprecated（使用 JSDoc 注释）
- 保留字段以兼容旧数据，但不使用

#### 1.7 更新 Server 配置
**文件**: `backend/src/server.ts`
- 替换 `visitorModeMiddleware` → `roleBasedAuthMiddleware`
- 替换 `visitorModeSettingsMiddleware` → `roleBasedSettingsMiddleware`

### Phase 2: Frontend 重构

#### 2.1 重构 VisitorModeContext
**文件**: `frontend/src/contexts/VisitorModeContext.tsx`
- 重命名为 `RoleBasedAuthContext.tsx` 或直接移除
- 逻辑改为：`visitorMode = userRole === 'visitor'`
- 不再依赖 settings 中的 `visitorMode`

#### 2.2 更新所有使用 VisitorMode 的组件
需要更新的文件：
- `frontend/src/components/Settings/SecuritySettings.tsx`
  - 移除 `visitorMode` switch
  - 保留 `visitorPassword` 输入（用于设置访客密码）
  - 更新说明文字：访客密码用于登录获取 visitor role

- `frontend/src/components/Header/*.tsx`
  - 使用 `userRole === 'visitor'` 替代 `visitorMode`

- `frontend/src/components/ManagePage/*.tsx`
  - 使用 `userRole === 'visitor'` 替代 `visitorMode`

- `frontend/src/components/VideoPlayer/*.tsx`
  - 使用 `userRole === 'visitor'` 替代 `visitorMode`

- `frontend/src/pages/*.tsx`
  - 使用 `userRole === 'visitor'` 替代 `visitorMode`

#### 2.3 更新 LoginPage
**文件**: `frontend/src/pages/LoginPage.tsx`
- 移除对 `visitorMode` 的检查
- Visitor tab 的显示逻辑改为：如果 `visitorPassword` 已设置，显示 Visitor tab
- 或者：始终显示 Visitor tab（如果设置了 visitorPassword）

#### 2.4 更新类型定义
**文件**: `frontend/src/types.ts`
- 移除 `visitorMode` 字段（或标记为 deprecated）
- 保留 `visitorPassword` 相关字段

### Phase 3: 测试更新

#### 3.1 Backend 测试
- `backend/src/__tests__/middleware/visitorModeMiddleware.test.ts`
  - 重命名为 `roleBasedAuthMiddleware.test.ts`
  - 更新测试用例：基于 `userRole` 而非 `visitorMode` 设置

- `backend/src/__tests__/middleware/visitorModeSettingsMiddleware.test.ts`
  - 重命名为 `roleBasedSettingsMiddleware.test.ts`
  - 更新测试用例

- `backend/src/__tests__/services/passwordService.test.ts`
  - 更新测试：移除 `visitorMode` 检查

#### 3.2 Frontend 测试
- 更新所有 mock `useVisitorMode` 的测试
- 改为 mock `useAuth` 并返回 `userRole: 'visitor'`

### Phase 4: 文档更新

#### 4.1 API 文档
- `documents/en/api-endpoints.md`
- `documents/zh/api-endpoints.md`
- 移除 `visitorMode` 相关说明

#### 4.2 代码注释
- 更新所有相关代码注释
- 添加 migration notes

## 迁移策略

### 数据迁移
1. **向后兼容**：
   - 保留 `visitorMode` 字段在 Settings 类型中（标记为 deprecated）
   - 不强制删除现有数据中的 `visitorMode` 字段

2. **自动迁移**（可选）：
   - 在启动时检查：如果 `visitorMode === true` 且 `visitorPassword` 已设置，记录警告
   - 提示用户：`visitorMode` 已废弃，权限现在基于 user role

### 渐进式迁移
1. **Phase 1**: 先完成 Backend 重构，确保 API 兼容
2. **Phase 2**: 再完成 Frontend 重构
3. **Phase 3**: 更新测试
4. **Phase 4**: 更新文档

## 风险评估

### 高风险
- **登录逻辑变更**：需要确保 visitor 登录仍然工作
- **权限控制变更**：需要确保 visitor 权限正确限制

### 中风险
- **前端组件更新**：大量组件需要更新
- **测试覆盖**：需要更新大量测试用例

### 低风险
- **文档更新**：纯文档工作

## 回滚计划

如果出现问题：
1. 保留旧代码在 git 分支中
2. 可以临时恢复 `visitorMode` 检查逻辑
3. 添加 feature flag 控制新旧逻辑切换（如果需要）

## 验收标准

1. ✅ Visitor 用户只能进行读操作（GET）
2. ✅ Visitor 用户不能进行写操作（POST, PUT, DELETE, PATCH）
3. ✅ Admin 用户拥有完全权限
4. ✅ 使用 `visitorPassword` 登录后获得 `visitor` role
5. ✅ 使用 `password` 登录后获得 `admin` role
6. ✅ 所有测试通过
7. ✅ 前端 UI 正确显示权限限制
8. ✅ 不再依赖 `visitorMode` 设置项

## 时间估算

- Phase 1 (Backend): 4-6 小时
- Phase 2 (Frontend): 6-8 小时
- Phase 3 (Tests): 3-4 小时
- Phase 4 (Docs): 1-2 小时

**总计**: 14-20 小时

## 文件清单

### Backend 需要修改的文件
1. `backend/src/middleware/visitorModeMiddleware.ts` → 重构/删除
2. `backend/src/middleware/visitorModeSettingsMiddleware.ts` → 重构/重命名
3. `backend/src/services/passwordService.ts` → 修改
4. `backend/src/services/settingsValidationService.ts` → 修改
5. `backend/src/controllers/settingsController.ts` → 修改
6. `backend/src/types/settings.ts` → 标记 deprecated
7. `backend/src/server.ts` → 更新中间件引用
8. `backend/src/__tests__/middleware/visitorModeMiddleware.test.ts` → 重构
9. `backend/src/__tests__/middleware/visitorModeSettingsMiddleware.test.ts` → 重构

### Frontend 需要修改的文件
1. `frontend/src/contexts/VisitorModeContext.tsx` → 重构/删除
2. `frontend/src/components/Settings/SecuritySettings.tsx` → 修改
3. `frontend/src/components/Header/*.tsx` (多个文件) → 修改
4. `frontend/src/components/ManagePage/*.tsx` (多个文件) → 修改
5. `frontend/src/components/VideoPlayer/*.tsx` (多个文件) → 修改
6. `frontend/src/pages/*.tsx` (多个文件) → 修改
7. `frontend/src/types.ts` → 修改
8. 所有相关测试文件 → 更新

### 文档需要更新的文件
1. `documents/en/api-endpoints.md`
2. `documents/zh/api-endpoints.md`
3. `documents/en/directory-structure.md`
4. `documents/zh/directory-structure.md`
