# 开始使用

## 前提条件

- Node.js (v14 或更高版本)
- npm (v6 或更高版本)
- Docker (可选，用于容器化部署)

## 安装

1. 克隆仓库：

   ```bash
   git clone <repository-url>
   cd mytube
   ```

2. 安装依赖：

   您可以使用一条命令安装根目录、前端和后端的所有依赖：

   ```bash
   npm run install:all
   ```

   或者手动安装：

   ```bash
   npm install
   cd frontend && npm install
   cd ../backend && npm install
   ```

#### 使用 npm 脚本

您可以在根目录下使用 npm 脚本：

```bash
npm run dev       # 以开发模式启动前端和后端
```

其他可用脚本：

```bash
npm run start     # 以生产模式启动前端和后端
npm run build     # 为生产环境构建前端
npm run lint      # 运行前端代码检查
npm run lint:fix  # 修复前端代码检查错误
```

## 访问应用

- 前端：http://localhost:5556
- 后端 API：http://localhost:5551
