# Video Info Parser - Chrome Extension

一个用于从当前网页提取视频元数据的Chrome扩展程序。

## 功能特性

- 🎬 **自动检测视频**：从当前打开的网页中自动检测视频信息
- 📊 **多源提取**：支持从Meta标签、Video元素、播放器结构等多个来源提取
- 🎯 **智能优先级**：根据数据来源自动排序，优先显示最可靠的结果
- 💎 **现代UI**：采用深色主题和玻璃态设计的精美界面
- 📋 **一键复制**：快速复制视频信息为JSON格式
- 🔌 **直达应用**：通过 Native Messaging 直接发送到桌面端收藏夹

## 提取的信息

扩展会提取以下视频元数据：

```json
{
  "title": "视频标题",
  "url": "视频URL或页面URL",
  "duration": "视频时长 (MM:SS 或 HH:MM:SS)",
  "thumbnailUrl": "视频封面图片URL"
}
```

## 安装方法

### 开发者模式安装

1. 打开Chrome浏览器，访问 `chrome://extensions/`
2. 在右上角启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本项目的根目录（包含 `manifest.json` 的文件夹）
5. 扩展安装完成！

## 使用方法

1. 打开任意包含视频的网页
2. 点击浏览器工具栏中的扩展图标
3. 扩展会自动分析当前页面并显示检测到的视频信息
4. 点击"复制JSON"按钮可将视频信息复制到剪贴板
5. 点击"发送到应用"可直接加入桌面端收藏夹
6. 点击"打开链接"可在新标签页中打开视频URL

## 项目结构

```
video-info-parser/
├── manifest.json          # 扩展配置文件
├── background.js          # 后台服务工作脚本
├── content.js            # 内容脚本（视频检测逻辑）
├── popup/
│   ├── popup.html        # 弹出窗口HTML
│   ├── popup.css         # 弹出窗口样式
│   └── popup.js          # 弹出窗口逻辑
├── icons/                # 扩展图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             # 项目说明文档
```

## 技术实现

### 视频检测策略

扩展采用三层检测策略，按优先级排序：

1. **Meta标签提取**（优先级最高）
   - Open Graph标签 (`og:title`, `og:video`, `og:image`, `og:video:duration`)
   - Twitter Card标签 (`twitter:title`, `twitter:image`, `twitter:player:stream`)
   - Schema.org结构化数据

2. **Video元素检测**
   - 直接检测页面中的 `<video>` 标签
   - 提取视频源、时长、封面等属性
   - 查找相关的标题元素

3. **播放器结构分析**
   - 检测常见视频播放器容器
   - 支持YouTube、Vimeo等嵌入式播放器
   - 分析iframe和播放器DOM结构

### 权限说明

- `activeTab`：访问当前激活标签页的内容
- `scripting`：注入内容脚本以分析页面
- `nativeMessaging`：将视频信息发送到本地桌面应用

**隐私保护**：所有数据分析都在本地进行，不会发送到任何外部服务器。

## Native Messaging 设置 (桌面端直达)

本扩展通过 Native Messaging 与桌面端应用通信。需要在系统中注册 native host。

### Windows 示例

1. 复制 `native/native-messaging-host.json` 并按需修改：
   - `path` 指向本机 `node.exe`
   - `args[0]` 指向本项目里的 `native/native-messaging-host.js`
   - `allowed_origins` 替换为扩展 ID
2. 将 manifest 注册到：
   `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.private_video_hub.desktop`
   值为 manifest 文件的完整路径
3. 确保桌面端应用已启动

> 端口默认为 `127.0.0.1:32145`，可通过环境变量 `VHUB_NATIVE_PORT` 调整。

## 兼容性

- Chrome 88+（支持Manifest V3）
- Edge 88+
- 其他基于Chromium的浏览器

## 开发说明

### 修改代码后重新加载

1. 在 `chrome://extensions/` 页面找到本扩展
2. 点击刷新图标重新加载扩展
3. 刷新测试页面以应用更改

### 调试

- **Popup调试**：右键点击扩展图标 → "检查弹出内容"
- **Content Script调试**：在网页上按F12打开开发者工具，查看Console
- **Background调试**：在 `chrome://extensions/` 页面点击"Service Worker"链接

## 许可证

MIT License

## 作者

Video Info Parser Extension
