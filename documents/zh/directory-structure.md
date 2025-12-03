# 目录结构

```
mytube/
├── backend/             # Express.js 后端 (TypeScript)
│   ├── src/             # 源代码
│   │   ├── config/      # 配置文件
│   │   ├── controllers/ # 路由控制器
│   │   ├── db/          # 数据库迁移和设置
│   │   ├── routes/      # API 路由
│   │   ├── services/    # 业务逻辑服务
│   │   ├── utils/       # 工具函数
│   │   └── server.ts    # 主服务器文件
│   ├── uploads/         # 上传文件目录
│   │   ├── videos/      # 下载的视频
│   │   └── images/      # 下载的缩略图
│   └── package.json     # 后端依赖
├── frontend/            # React.js 前端 (Vite + TypeScript)
│   ├── src/             # 源代码
│   │   ├── assets/      # 图片和样式
│   │   ├── components/  # React 组件
│   │   ├── contexts/    # React 上下文
│   │   ├── pages/       # 页面组件
│   │   ├── utils/       # 工具和多语言文件
│   │   └── theme.ts     # 主题配置
│   └── package.json     # 前端依赖
├── build-and-push.sh    # Docker 构建脚本
├── docker-compose.yml   # Docker Compose 配置
├── DEPLOYMENT.md        # 部署指南
├── CONTRIBUTING.md      # 贡献指南
└── package.json         # 运行两个应用的根 package.json
```
