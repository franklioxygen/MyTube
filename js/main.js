(function () {
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const mobileNav = document.getElementById("mobile-nav");
  const i18n = window.MyTubeI18n;

  function menuLabelKey(open) {
    return open ? "a11y.menuClose" : "a11y.menuOpen";
  }

  function setMenuAriaLabel(open) {
    if (!toggle || !i18n) return;
    toggle.setAttribute("aria-label", i18n.t(menuLabelKey(open)));
  }

  function closeMobileNav() {
    if (!toggle || !mobileNav) return;
    toggle.setAttribute("aria-expanded", "false");
    setMenuAriaLabel(false);
    mobileNav.hidden = true;
  }

  if (i18n) {
    i18n.initLangToggle();
    document.addEventListener("mytube:langchange", () => {
      const open = toggle?.getAttribute("aria-expanded") === "true";
      setMenuAriaLabel(open);
      document.querySelectorAll(".copy-btn").forEach((btn) => {
        if (!btn.classList.contains("copied")) {
          btn.textContent = i18n.t("quickStart.copy");
        }
      });
    });
  }

  if (toggle && mobileNav) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      setMenuAriaLabel(!open);
      mobileNav.hidden = open;
    });

    mobileNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMobileNav);
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (e) => {
      const id = anchor.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const offset = header ? header.offsetHeight + 8 : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
      closeMobileNav();
    });
  });

  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy");
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = i18n ? i18n.t("quickStart.copied") : "Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = i18n ? i18n.t("quickStart.copy") : "Copy";
          btn.classList.remove("copied");
        }, 2000);
      } catch {
        btn.textContent = i18n ? i18n.t("quickStart.copyFailed") : "Failed";
        setTimeout(() => {
          btn.textContent = i18n ? i18n.t("quickStart.copy") : "Copy";
        }, 2000);
      }
    });
  });

  const revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    revealEls.forEach((el) => observer.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("visible"));
  }
})();
