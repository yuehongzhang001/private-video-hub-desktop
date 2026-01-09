# 视频时长提取增强说明

## 问题
原始版本无法正确解析视频的duration字段。

## 解决方案
实现了**8种**不同的duration提取方法，按优先级顺序尝试：

### 1. Meta标签提取
- `og:video:duration` - Open Graph视频时长（秒）
- `video:duration` - 通用视频时长meta标签
- `duration` - 简单duration meta标签

### 2. JSON-LD Schema.org结构化数据
- 解析 `<script type="application/ld+json">` 中的duration字段
- 支持ISO 8601格式（如 `PT1H2M3S` = 1小时2分3秒）
- 自动转换为 `HH:MM:SS` 或 `MM:SS` 格式

### 3. Video元素属性
- `video.duration` - HTML5 video元素的duration属性
- 添加了 `Infinity` 检查（某些视频在未加载时返回Infinity）

### 4. Data属性
- `data-duration` - 自定义数据属性
- `duration` - HTML属性
- `data-length` - 备用长度属性

### 5. 附近文本内容解析
在video元素的父容器中查找时长文本，支持以下格式：
- `HH:MM:SS` (如 01:23:45)
- `MM:SS` (如 03:31)
- `duration: MM:SS`
- `length: MM:SS`

### 6. CSS类名查找
查找包含以下类名的元素：
- `*duration*`
- `*time*`
- `*length*`

然后提取其中的时长文本。

## 使用方法

1. 重新加载扩展：
   - 打开 `chrome://extensions/`
   - 找到 Private Video Hub
   - 点击刷新图标 🔄

2. 测试：
   - 访问任意视频网站
   - 点击扩展图标
   - 检查duration字段是否正确显示

## 支持的时长格式

**输入格式**：
- 秒数（如 `211` → `03:31`）
- ISO 8601（如 `PT3M31S` → `03:31`）
- 已格式化文本（如 `03:31` → `03:31`）

**输出格式**：
- 小于1小时：`MM:SS` (如 `03:31`)
- 大于等于1小时：`HH:MM:SS` (如 `01:23:45`)

## 调试建议

如果仍然无法提取duration，请：

1. 打开开发者工具（F12）
2. 在Console中运行：
   ```javascript
   // 查看meta标签
   document.querySelectorAll('meta[property*="duration"], meta[name*="duration"]')
   
   // 查看JSON-LD
   document.querySelectorAll('script[type="application/ld+json"]')
   
   // 查看video元素
   document.querySelectorAll('video')
   ```

3. 将结果反馈，我可以进一步优化提取逻辑
