// 主 JavaScript 文件

document.addEventListener('DOMContentLoaded', function() {
  // 移动端菜单切换
  initMobileMenu();
  
  // 返回顶部按钮
  initBackToTop();
  
  // 平滑滚动
  initSmoothScroll();
  
  // 代码复制功能
  initCodeCopy();
  
  // 图片懒加载
  initLazyLoad();
});

// 移动端菜单
function initMobileMenu() {
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('.nav-menu');
  
  if (!navToggle || !navMenu) return;
  
  navToggle.addEventListener('click', function() {
    const isExpanded = this.getAttribute('aria-expanded') === 'true';
    this.setAttribute('aria-expanded', !isExpanded);
    navMenu.classList.toggle('is-open');
    document.body.style.overflow = isExpanded ? '' : 'hidden';
  });
  
  // 点击外部关闭菜单
  document.addEventListener('click', function(e) {
    if (!navToggle.contains(e.target) && !navMenu.contains(e.target)) {
      navToggle.setAttribute('aria-expanded', 'false');
      navMenu.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  });
  
  // 窗口调整时关闭菜单
  window.addEventListener('resize', function() {
    if (window.innerWidth > 768) {
      navToggle.setAttribute('aria-expanded', 'false');
      navMenu.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  });
}

// 返回顶部
function initBackToTop() {
  // 创建返回顶部按钮
  const backToTop = document.createElement('button');
  backToTop.className = 'back-to-top';
  backToTop.setAttribute('aria-label', '返回顶部');
  backToTop.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 15l-6-6-6 6"/>
    </svg>
  `;
  document.body.appendChild(backToTop);
  
  // 显示/隐藏按钮
  function toggleBackToTop() {
    if (window.pageYOffset > 300) {
      backToTop.classList.add('is-visible');
    } else {
      backToTop.classList.remove('is-visible');
    }
  }
  
  window.addEventListener('scroll', toggleBackToTop);
  
  // 点击返回顶部
  backToTop.addEventListener('click', function() {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}

// 平滑滚动
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        
        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

// 代码块复制功能（可选）
function initCodeCopy() {
  document.querySelectorAll('pre').forEach(pre => {
    const button = document.createElement('button');
    button.className = 'code-copy';
    button.textContent = '复制';
    
    button.addEventListener('click', function() {
      const code = pre.querySelector('code');
      if (code) {
        navigator.clipboard.writeText(code.textContent).then(() => {
          button.textContent = '已复制!';
          setTimeout(() => {
            button.textContent = '复制';
          }, 2000);
        });
      }
    });
    
    pre.style.position = 'relative';
    pre.appendChild(button);
  });
}

// 图片懒加载
function initLazyLoad() {
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          observer.unobserve(img);
        }
      });
    });
    
    document.querySelectorAll('img[data-src]').forEach(img => {
      imageObserver.observe(img);
    });
  }
}
