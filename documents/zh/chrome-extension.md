# 浏览器扩展

本项目包含一个 Chrome 扩展，让下载更加便捷。

## 功能
- 在视频网站上提供一键下载按钮。
- 在其他支持的站点上提供“下载当前页面”按钮。
- 连接测试功能，验证服务器是否可访问。

## 安装

### 快速安装 (推荐)
1. 下载 [mytube-extension-v1.0.1.zip](../../chrome-extension/mytube-extension-v1.0.1.zip) 文件。
2. 将文件解压到一个文件夹。
3. 打开 Chrome 浏览器并访问 `chrome://extensions/`。
4. 启用“开发者模式” (Developer mode)（右上角开关）。
5. 点击“加载已解压的扩展程序” (Load unpacked)。
6. 选择解压后的文件夹。
7. 扩展程序现已安装完成！

### 从源码安装
1. 进入 `chrome-extension` 目录。
2. 安装依赖并构建：
   ```bash
   cd chrome-extension
   npm install
   npm run build
   ```
3. 打开 Chrome 浏览器并访问 `chrome://extensions/`。
4. 启用“开发者模式” (Developer mode)。
5. 点击“加载已解压的扩展程序” (Load unpacked)，选择 `chrome-extension` 目录。

更多详情，请参阅 [Chrome 扩展文档](../../chrome-extension/README.md).
