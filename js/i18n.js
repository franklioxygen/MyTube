(function (global) {
  const STORAGE_KEY = "mytube-home-lang";

  const strings = {
    en: {
      meta: {
        title: "MyTube — Self-hosted video library & downloader",
        description:
          "MyTube — self-hosted downloader and player for YouTube, Bilibili, Twitch, and 1000+ sites. Subscriptions, collections, RSS feeds, Docker-ready.",
      },
      a11y: {
        skip: "Skip to content",
        brand: "MyTube home",
        nav: "Primary",
        menuOpen: "Open menu",
        menuClose: "Close menu",
        langSwitch: "Language",
      },
      nav: {
        features: "Features",
        ui: "Web UI",
        platforms: "Platforms",
        ecosystem: "Ecosystem",
        getStarted: "Get started",
        github: "GitHub",
        demo: "Live demo",
      },
      hero: {
        badgeSelfHosted: "Self-hosted",
        badgeDocker: "Docker ready",
        title: "Your personal video library — download, organize, and watch on your terms.",
        lead:
          "MyTube is a self-hosted downloader and player for YouTube, Bilibili, Twitch, MissAV, and every yt-dlp site. Subscribe to channels, queue batch downloads, curate collections, and share private RSS feeds — all from a sleek web UI.",
        ctaDemo: "Try live demo",
        ctaQuickStart: "Quick start",
        ctaSource: "View source",
        mockTitle: "MyTube — Library",
        mockSearch: "Search your library…",
        mockQueue: "Download queue",
        mockItem1: "Channel upload — 68%",
        mockItem2: "Batch import — queued",
        mockItem3: "Subscription sync — done",
        mockCollections: "Collections",
        mockColl1: "Tech talks",
        mockColl2: "Anime",
        mockColl3: "Documentaries",
      },
      highlights: {
        h1Title: "Own your library",
        h1Body:
          "Videos stay on your disk under your control. No algorithmic feed, no account lock-in — just a private media server you run.",
        h2Title: "Subscribe & automate",
        h2Body:
          "Follow YouTube, Bilibili, and Twitch channels. New uploads land in your library automatically while you sleep.",
        h3Title: "Secure sharing",
        h3Body:
          "Password login, optional passkeys, read-only visitor accounts, and filtered private RSS links for external readers.",
      },
      features: {
        eyebrow: "Features",
        title: "Everything you need to build a personal streaming hub.",
        lead:
          "From a single URL paste to full subscription automation — MyTube covers download, playback, metadata, and integration.",
        f1Title: "Multi-site downloads",
        f1Body: "Paste a URL from YouTube, Bilibili, Twitch, MissAV, or any yt-dlp-supported site.",
        f2Title: "Batch & parallel queue",
        f2Body: "Add many links at once, track progress side-by-side, and cap concurrent downloads.",
        f3Title: "Channel subscriptions",
        f3Body: "Auto-download new uploads from subscribed creators across major platforms.",
        f4Title: "Collections",
        f4Body: "Organize videos into custom playlists and collections for fast browsing.",
        f5Title: "Private RSS feeds",
        f5Body: "Generate filtered RSS links for Plex, readers, or any compatible app.",
        f6Title: "Auto subtitles",
        f6Body: "Pull default-language subtitles from YouTube and Bilibili automatically.",
        f7Title: "TMDB metadata",
        f7Body: "Scrape movie and TV metadata from filenames with localized TMDB matching.",
        f8Title: "Cloud storage sync",
        f8Body: "Upload videos and thumbnails to OpenList/Alist after download completes.",
        f9Title: "Task hooks & Telegram",
        f9Body: "Run shell scripts on download events or get instant Telegram notifications.",
        f10Title: "Chrome extension",
        f10Body: "Send videos to MyTube directly from your browser on any supported site.",
        f11Title: "Cloudflare Tunnel",
        f11Body: "Expose your instance securely without port forwarding — built into settings.",
        f12Title: "10+ UI languages",
        f12Body: "English, Chinese, Japanese, Korean, and more — switch anytime in the app.",
      },
      ui: {
        eyebrow: "Web UI",
        title: "Manage your library without leaving the browser.",
        lead:
          "A modern React interface with Material Design — search, filter, upload local files, manage subscriptions, and watch inline.",
        li1: "Responsive layout tuned for phones and tablets",
        li2: "Inline player with collections, tags, and author views",
        li3: "Settings for yt-dlp, cookies, TMDB, hooks, and tunnels",
        li4: "Upload local videos with automatic thumbnail generation",
        caption: "Watch the overview on YouTube",
        imgAlt: "MyTube demo video thumbnail",
      },
      platforms: {
        eyebrow: "Supported sources",
        title: "One app, hundreds of sites.",
        lead:
          "MyTube uses yt-dlp under the hood — first-class support for the platforms you care about, plus every site in the yt-dlp catalog.",
        noteBefore: "Need the full list? ",
        readmeLink: "Browse yt-dlp supported sites →",
        chipYoutube: "YouTube",
        chipBilibili: "Bilibili",
        chipTwitch: "Twitch",
        chipMissav: "MissAV",
        chipYtdlp: "1000+ yt-dlp sites",
      },
      ecosystem: {
        eyebrow: "Ecosystem",
        title: "Clients and extensions that extend MyTube.",
        e1Title: "Chrome extension",
        e1Body: "Download from the page you're on — supports all yt-dlp sites.",
        e2Title: "MikMok",
        e2Body: "Short-form web client with a feed-style experience for vertical videos.",
        e3Title: "mytube-android",
        e3Body: "Native Android app for browsing and playback via the MyTube API.",
      },
      security: {
        eyebrow: "Security",
        title: "Share safely, stay in control.",
        li1: "Password login with optional WebAuthn passkeys",
        li2: "Read-only visitor role for demos and family sharing",
        li3: "Three-tier admin trust model for Docker deployments",
        li4: "Cookie upload for age-restricted or member-only content",
      },
      quickStart: {
        eyebrow: "Quick start",
        title: "From Docker pull to first download in minutes.",
        s1Title: "Docker (recommended)",
        s1Body: "Pull the official GHCR image and expose port 5551.",
        s2Title: "From source",
        s2Body: "Clone the repo, install dependencies, and run the dev servers.",
        s3Title: "Open the UI",
        s3Body: "Visit <code>localhost:5551</code>, paste a video URL, and hit download.",
        copy: "Copy",
        copied: "Copied",
        copyFailed: "Failed",
        copyCmd: "Copy command",
        copyCmds: "Copy commands",
        reqsTitle: "Requirements",
        req1Title: "Node.js 20–26",
        req1Body: "for local development (Docker ships Node 22)",
        req2Title: "yt-dlp + ffmpeg",
        req2Body: "required for downloads and transcoding",
        req3Title: "Python 3.8+",
        req3Body: "for yt-dlp and PO Token provider plugin",
      },
      stack: {
        eyebrow: "Technology",
        title: "Modern stack, production-ready.",
        backend: "Backend",
        backendBody: "Node.js · Express · TypeScript · SQLite · Drizzle ORM · Vitest",
        frontend: "Frontend",
        frontendBody: "React 19 · Vite · Material UI · React Query · React Router 7",
      },
      cta: {
        title: "Ready to own your video library?",
        body: "Free, open source, and MIT licensed. Star the repo, spin up Docker, or try the read-only demo.",
        demo: "Live demo",
        star: "Star on GitHub",
      },
      footer: {
        license: "MIT License · ",
        docLink: "中文文档",
        docHref: "https://github.com/franklioxygen/mytube/blob/master/README-zh.md",
        discord: "Discord",
      },
    },
    zh: {
      meta: {
        title: "MyTube — 自托管视频库与下载器",
        description:
          "MyTube — 支持 YouTube、Bilibili、Twitch 及 1000+ 站点的自托管下载器与播放器。订阅、收藏、RSS、Docker 一键部署。",
      },
      a11y: {
        skip: "跳到正文",
        brand: "MyTube 首页",
        nav: "主导航",
        menuOpen: "打开菜单",
        menuClose: "关闭菜单",
        langSwitch: "语言",
      },
      nav: {
        features: "功能",
        ui: "Web 界面",
        platforms: "平台",
        ecosystem: "生态",
        getStarted: "快速开始",
        github: "GitHub",
        demo: "在线演示",
      },
      hero: {
        badgeSelfHosted: "自托管",
        badgeDocker: "Docker 就绪",
        title: "你的私人视频库 — 按你的方式下载、整理与观看。",
        lead:
          "MyTube 是面向 YouTube、Bilibili、Twitch、MissAV 及所有 yt-dlp 站点的自托管下载器与播放器。订阅频道、批量排队下载、整理收藏夹、分享私密 RSS — 一切尽在精美的 Web 界面中。",
        ctaDemo: "体验在线演示",
        ctaQuickStart: "快速开始",
        ctaSource: "查看源码",
        mockTitle: "MyTube — 媒体库",
        mockSearch: "搜索媒体库…",
        mockQueue: "下载队列",
        mockItem1: "频道新上传 — 68%",
        mockItem2: "批量导入 — 排队中",
        mockItem3: "订阅同步 — 已完成",
        mockCollections: "收藏夹",
        mockColl1: "技术演讲",
        mockColl2: "动漫",
        mockColl3: "纪录片",
      },
      highlights: {
        h1Title: "数据归你所有",
        h1Body: "视频保存在你的磁盘上，完全由你掌控。没有算法推荐、没有账号绑架 — 只有你自己运行的私人媒体服务器。",
        h2Title: "订阅与自动化",
        h2Body: "关注 YouTube、Bilibili 和 Twitch 频道。新上传在你休息时自动进入媒体库。",
        h3Title: "安全分享",
        h3Body: "密码登录、可选通行密钥、只读访客账号，以及带过滤条件的私密 RSS 链接。",
      },
      features: {
        eyebrow: "功能特性",
        title: "打造个人流媒体中心所需的一切。",
        lead: "从粘贴单个链接到完整订阅自动化 — MyTube 覆盖下载、播放、元数据与集成。",
        f1Title: "多站点下载",
        f1Body: "粘贴 YouTube、Bilibili、Twitch、MissAV 或任意 yt-dlp 支持站点的链接。",
        f2Title: "批量与并行队列",
        f2Body: "一次添加多个链接，并排追踪进度，并限制并发下载数。",
        f3Title: "频道订阅",
        f3Body: "订阅主流平台创作者，自动下载新上传内容。",
        f4Title: "收藏夹",
        f4Body: "将视频整理到自定义播放列表与收藏夹，快速浏览。",
        f5Title: "私密 RSS",
        f5Body: "生成带过滤条件的 RSS 链接，供 Plex、阅读器或兼容应用使用。",
        f6Title: "自动字幕",
        f6Body: "自动拉取 YouTube 与 Bilibili 的默认语言字幕。",
        f7Title: "TMDB 元数据",
        f7Body: "根据文件名抓取影视元数据，支持本地化 TMDB 匹配。",
        f8Title: "云存储同步",
        f8Body: "下载完成后自动上传视频与缩略图至 OpenList/Alist。",
        f9Title: "任务钩子与 Telegram",
        f9Body: "在下载各阶段执行 Shell 脚本，或通过 Telegram 即时通知。",
        f10Title: "Chrome 扩展",
        f10Body: "在浏览器中直接从当前页面发送到 MyTube，支持所有 yt-dlp 站点。",
        f11Title: "Cloudflare Tunnel",
        f11Body: "无需端口映射即可安全暴露实例 — 内置在设置中。",
        f12Title: "10+ 界面语言",
        f12Body: "英语、中文、日语、韩语等 — 在应用内随时切换。",
      },
      ui: {
        eyebrow: "Web 界面",
        title: "在浏览器中管理整个媒体库。",
        lead: "基于 React 与 Material Design 的现代界面 — 搜索、筛选、上传本地文件、管理订阅并内联播放。",
        li1: "针对手机与平板优化的响应式布局",
        li2: "内联播放器，支持收藏夹、标签与作者视图",
        li3: "yt-dlp、Cookie、TMDB、钩子与隧道等设置",
        li4: "上传本地视频并自动生成缩略图",
        caption: "在 YouTube 观看概览视频",
        imgAlt: "MyTube 演示视频缩略图",
      },
      platforms: {
        eyebrow: "支持来源",
        title: "一个应用，数百个站点。",
        lead: "MyTube 底层使用 yt-dlp — 对你关心的平台有一流支持，并覆盖 yt-dlp 目录中的每个站点。",
        noteBefore: "需要完整列表？",
        readmeLink: "浏览 yt-dlp 支持站点 →",
        chipYoutube: "YouTube",
        chipBilibili: "Bilibili",
        chipTwitch: "Twitch",
        chipMissav: "MissAV",
        chipYtdlp: "1000+ yt-dlp 站点",
      },
      ecosystem: {
        eyebrow: "生态系统",
        title: "扩展 MyTube 的客户端与插件。",
        e1Title: "Chrome 扩展",
        e1Body: "从当前页面直接下载 — 支持所有 yt-dlp 站点。",
        e2Title: "MikMok",
        e2Body: "短视频 Web 客户端，提供更适合竖屏内容的流式浏览体验。",
        e3Title: "mytube-android",
        e3Body: "原生 Android 应用，通过 MyTube API 浏览与播放。",
      },
      security: {
        eyebrow: "安全",
        title: "安全分享，掌控在手。",
        li1: "密码登录，可选 WebAuthn 通行密钥",
        li2: "只读访客角色，便于演示与家人共享",
        li3: "Docker 部署的三档管理员信任模型",
        li4: "上传 Cookie 以下载年龄限制或会员内容",
      },
      quickStart: {
        eyebrow: "快速开始",
        title: "几分钟内从 Docker 拉取到首次下载。",
        s1Title: "Docker（推荐）",
        s1Body: "拉取官方 GHCR 镜像并暴露 5551 端口。",
        s2Title: "从源码运行",
        s2Body: "克隆仓库、安装依赖并启动开发服务器。",
        s3Title: "打开界面",
        s3Body: "访问 <code>localhost:5551</code>，粘贴视频链接并开始下载。",
        copy: "复制",
        copied: "已复制",
        copyFailed: "失败",
        copyCmd: "复制命令",
        copyCmds: "复制命令",
        reqsTitle: "环境要求",
        req1Title: "Node.js 20–26",
        req1Body: "本地开发需要（Docker 内置 Node 22）",
        req2Title: "yt-dlp + ffmpeg",
        req2Body: "下载与转码必需",
        req3Title: "Python 3.8+",
        req3Body: "用于 yt-dlp 与 PO Token 插件",
      },
      stack: {
        eyebrow: "技术栈",
        title: "现代架构，生产可用。",
        backend: "后端",
        backendBody: "Node.js · Express · TypeScript · SQLite · Drizzle ORM · Vitest",
        frontend: "前端",
        frontendBody: "React 19 · Vite · Material UI · React Query · React Router 7",
      },
      cta: {
        title: "准备好拥有自己的视频库了吗？",
        body: "免费开源，MIT 许可。给仓库标星、启动 Docker，或体验只读演示。",
        demo: "在线演示",
        star: "在 GitHub 标星",
      },
      footer: {
        license: "MIT 许可证 · ",
        docLink: "English Doc",
        docHref: "https://github.com/franklioxygen/mytube/blob/master/README.md",
        discord: "Discord",
      },
    },
  };

  function getNested(obj, path) {
    return path.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
  }

  function detectLang() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") return stored;
    } catch (e) {}
    const browser = (navigator.language || "").toLowerCase();
    return browser.startsWith("zh") ? "zh" : "en";
  }

  let currentLang = detectLang();

  function t(key) {
    return getNested(strings[currentLang], key) ?? getNested(strings.en, key) ?? "";
  }

  function applyLang(lang) {
    currentLang = lang === "zh" ? "zh" : "en";
    try {
      localStorage.setItem(STORAGE_KEY, currentLang);
    } catch (e) {}

    const htmlLang = currentLang === "zh" ? "zh-CN" : "en";
    document.documentElement.lang = htmlLang;
    document.documentElement.dataset.lang = currentLang;

    document.title = t("meta.title");
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", t("meta.description"));

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const value = t(key);
      if (value == null || value === "") return;
      if (el.hasAttribute("data-i18n-html")) {
        el.innerHTML = value;
      } else {
        el.textContent = value;
      }
    });

    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      const spec = el.getAttribute("data-i18n-attr");
      if (!spec) return;
      spec.split(";").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });

    document.querySelectorAll("[data-i18n-href]").forEach((el) => {
      const key = el.getAttribute("data-i18n-href");
      if (key) el.setAttribute("href", t(key));
    });

    document.querySelectorAll(".lang-option").forEach((btn) => {
      const active = btn.getAttribute("data-lang") === currentLang;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    document.dispatchEvent(new CustomEvent("mytube:langchange", { detail: { lang: currentLang } }));
  }

  function initLangToggle() {
    document.querySelectorAll(".lang-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lang = btn.getAttribute("data-lang");
        if (lang && lang !== currentLang) applyLang(lang);
      });
    });
  }

  global.MyTubeI18n = {
    t,
    applyLang,
    initLangToggle,
    getLang: () => currentLang,
    detectLang,
  };

  applyLang(currentLang);
})(window);
