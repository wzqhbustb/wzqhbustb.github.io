# 个人博客

一个基于 Jekyll + GitHub Pages 的简约现代风格个人博客。

## 特性

- ✨ **简约现代设计** - 干净、优雅、专注内容的视觉体验
- 📱 **响应式布局** - 完美适配桌面、平板和手机
- 🚀 **GitHub Pages 原生支持** - 无需额外构建步骤
- 🎨 **精美的 CSS 动画** - 悬浮效果、过渡动画增强体验
- 📝 **Markdown 支持** - 使用 Markdown 编写文章
- 🔍 **SEO 优化** - 内置 jekyll-seo-tag 插件
- 🌙 **深色模式支持** - 自动适配系统深色模式（可选）

## 项目结构

```
├── _config.yml           # 站点配置
├── _includes/            # 可复用的 HTML 组件
│   ├── footer.html
│   └── header.html
├── _layouts/             # 页面布局模板
│   ├── default.html
│   ├── page.html
│   └── post.html
├── _posts/               # 博客文章
│   ├── 2024-03-05-hello-world.md
│   └── 2024-03-10-clean-code-principles.md
├── _sass/                # SCSS 样式文件
│   ├── _base.scss
│   ├── _components.scss
│   ├── _footer.scss
│   ├── _header.scss
│   ├── _hero.scss
│   ├── _page.scss
│   ├── _post.scss
│   ├── _posts.scss
│   └── _variables.scss
├── assets/
│   ├── css/
│   │   └── main.scss     # 主样式入口
│   ├── js/
│   │   └── main.js       # JavaScript 功能
│   └── images/           # 图片资源
├── categories/           # 分类页面
│   ├── life.html
│   └── tech.html
├── about.md              # 关于页面
├── archive.html          # 文章归档
├── index.html            # 首页
└── Gemfile               # Ruby 依赖
```

## 快速开始

### 1. 创建 GitHub 仓库

1. 在 GitHub 上创建一个新仓库，命名为 `your-username.github.io`
2. 将本项目的所有文件推送到该仓库

### 2. 配置站点信息

编辑 `_config.yml` 文件：

```yaml
title: "你的博客标题"
description: "博客描述"
author: "你的名字"
email: "your.email@example.com"
url: "https://your-username.github.io"

social:
  github: your-github-username
  twitter: your-twitter-username
  email: your.email@example.com
```

### 3. 编写文章

在 `_posts` 目录下创建 Markdown 文件，文件名格式为：`YYYY-MM-DD-title.md`

```markdown
---
layout: post
title: "文章标题"
description: "文章简介"
date: 2024-03-05
categories: [tech]  # 可选: tech, life
tags: [标签1, 标签2]
---

文章内容使用 Markdown 格式编写...
```

### 4. 本地预览（可选）

```bash
# 安装依赖
bundle install

# 启动本地服务器
bundle exec jekyll serve

# 访问 http://localhost:4000
```

### 5. 部署

推送到 GitHub 后，GitHub Pages 会自动构建并部署你的博客。

访问 `https://your-username.github.io` 查看效果。

## 自定义主题

### 修改颜色

编辑 `_sass/_variables.scss` 文件：

```scss
:root {
  --color-primary: #2563eb;        // 主色调
  --color-text: #1f2937;           // 文字颜色
  --color-bg: #ffffff;             // 背景颜色
  // ...
}
```

### 添加新页面

1. 在项目根目录创建 `.md` 或 `.html` 文件
2. 添加 front matter：

```markdown
---
layout: page
title: 页面标题
---

页面内容...
```

3. 在 `_config.yml` 的 `nav` 中添加导航链接

## 写作指南

### 文章分类

- `tech` - 技术类文章
- `life` - 人生思考类文章

### Markdown 技巧

```markdown
## 标题

**粗体** *斜体* ~~删除线~~

[链接文本](https://example.com)

![图片描述](/assets/images/image.jpg)

> 引用文本

- 列表项 1
- 列表项 2

| 表格 | 表头 |
|------|------|
| 内容 | 内容 |

```代码块```
```

## 许可证

MIT License - 你可以自由使用和修改本项目。

## 致谢

- [Jekyll](https://jekyllrb.com/) - 静态网站生成器
- [GitHub Pages](https://pages.github.com/) - 免费托管服务
- [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC) - 中文字体
