# Personal Blog

A minimalist and modern personal blog built with Jekyll + GitHub Pages.

## Features

- ✨ **Minimalist Modern Design** - Clean, elegant, content-focused visual experience
- 📱 **Responsive Layout** - Perfectly adapts to desktop, tablet, and mobile
- 🚀 **GitHub Pages Native Support** - No additional build steps required
- 🎨 **Beautiful CSS Animations** - Hover effects and transitions enhance the experience
- 📝 **Markdown Support** - Write posts using Markdown
- 🔍 **SEO Optimized** - Built-in jekyll-seo-tag plugin
- 🌙 **Dark Mode Support** - Automatically adapts to system dark mode (optional)

## Project Structure

```
├── _config.yml           # Site configuration
├── _includes/            # Reusable HTML components
│   ├── footer.html
│   └── header.html
├── _layouts/             # Page layout templates
│   ├── default.html
│   ├── page.html
│   └── post.html
├── _posts/               # Blog posts
│   ├── 2024-03-05-hello-world.md
│   └── 2024-03-10-clean-code-principles.md
├── _sass/                # SCSS style files
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
│   │   └── main.scss     # Main style entry
│   ├── js/
│   │   └── main.js       # JavaScript functionality
│   └── images/           # Image assets
├── categories/           # Category pages
│   ├── life.html
│   └── tech.html
├── about.md              # About page
├── archive.html          # Post archive
├── index.html            # Home page
└── Gemfile               # Ruby dependencies
```

## Quick Start

### 1. Create GitHub Repository

1. Create a new repository on GitHub named `your-username.github.io`
2. Push all files from this project to that repository

### 2. Configure Site Information

Edit the `_config.yml` file:

```yaml
title: "Your Blog Title"
description: "Blog description"
author: "Your Name"
email: "your.email@example.com"
url: "https://your-username.github.io"

social:
  github: your-github-username
  twitter: your-twitter-username
  email: your.email@example.com
```

### 3. Write Posts

Create Markdown files in the `_posts` directory with the format: `YYYY-MM-DD-title.md`

```markdown
---
layout: post
title: "Post Title"
description: "Post description"
date: 2024-03-05
categories: [tech]  # Options: tech, life
tags: [tag1, tag2]
---

Post content written in Markdown...
```

### 4. Local Preview (Optional)

```bash
# Install dependencies
bundle install

# Start local server
bundle exec jekyll serve

# Visit http://localhost:4000
```

### 5. Deploy

After pushing to GitHub, GitHub Pages will automatically build and deploy your blog.

Visit `https://your-username.github.io` to see the result.

## Customization

### Change Colors

Edit the `_sass/_variables.scss` file:

```scss
:root {
  --color-primary: #2563eb;        // Primary color
  --color-text: #1f2937;           // Text color
  --color-bg: #ffffff;             // Background color
  // ...
}
```

### Add New Pages

1. Create `.md` or `.html` files in the project root
2. Add front matter:

```markdown
---
layout: page
title: Page Title
---

Page content...
```

3. Add navigation links in `_config.yml` under `nav`

## Writing Guide

### Post Categories

- `tech` - Technical articles
- `life` - Life reflections

### Markdown Tips

```markdown
## Heading

**Bold** *Italic* ~~Strikethrough~~

[Link text](https://example.com)

![Image description](/assets/images/image.jpg)

> Quote text

- List item 1
- List item 2

| Table | Header |
|-------|--------|
| Content | Content |

```code block```
```

## License

MIT License - You are free to use and modify this project.

## Acknowledgments

- [Jekyll](https://jekyllrb.com/) - Static site generator
- [GitHub Pages](https://pages.github.com/) - Free hosting service
- [Noto Sans](https://fonts.google.com/noto) - Font family
