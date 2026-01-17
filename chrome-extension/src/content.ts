// Content script for detecting video pages and adding download buttons
// Note: The extension supports all yt-dlp sites via the popup/download functionality.
// This content script adds a floating button for specific popular sites where
// we can reliably detect video pages.

(function () {
  'use strict';

  interface SiteConfig {
    urlPattern: RegExp;
    getVideoUrl: () => string;
    shouldShowButton: () => boolean;
  }

  interface DetectedSite {
    name: string;
    config: SiteConfig;
  }

  type NotificationType = 'success' | 'error' | 'info';

  interface ButtonStyles {
    background: string;
    color: string;
    boxShadow: string;
    boxShadowHover: string;
  }

  const supportedSites: Record<string, SiteConfig> = {
    youtube: {
      urlPattern: /(?:youtube\.com|youtu\.be)/,
      getVideoUrl: () => {
        if (window.location.hostname.includes('youtu.be')) {
          return window.location.href;
        }
        const urlParams = new URLSearchParams(window.location.search);
        const videoId = urlParams.get('v');
        if (videoId) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
        return window.location.href;
      },
      shouldShowButton: () => {
        const urlParams = new URLSearchParams(window.location.search);
        return (
          urlParams.has('v') || window.location.pathname.startsWith('/watch')
        );
      },
    },
    bilibili: {
      urlPattern: /bilibili\.com/,
      getVideoUrl: () => window.location.href.split('?')[0],
      shouldShowButton: () => {
        return window.location.pathname.startsWith('/video/');
      },
    },
    missav: {
      urlPattern: /(missav|123av)\.com/,
      getVideoUrl: () => window.location.href.split('?')[0],
      shouldShowButton: () => {
        return (
          window.location.pathname.includes('/cn/') ||
          window.location.pathname.includes('/ja/')
        );
      },
    },
  };

  // Detect current site
  function detectSite(): DetectedSite | null {
    const hostname = window.location.hostname;
    for (const [siteName, siteConfig] of Object.entries(supportedSites)) {
      if (siteConfig.urlPattern.test(hostname)) {
        return { name: siteName, config: siteConfig };
      }
    }
    return null;
  }

  // Detect if website is using dark theme
  function isDarkTheme(): boolean {
    // Check for common dark mode indicators
    const html = document.documentElement;
    const body = document.body;
    
    // Check computed styles
    const bgColor = window.getComputedStyle(body).backgroundColor;
    const htmlBgColor = window.getComputedStyle(html).backgroundColor;
    
    // Parse RGB values
    const parseRGB = (rgb: string): number[] => {
      const match = rgb.match(/\d+/g);
      return match ? match.map(Number) : [255, 255, 255];
    };
    
    const bgRGB = parseRGB(bgColor);
    const htmlRGB = parseRGB(htmlBgColor);
    
    // Calculate luminance
    const getLuminance = (rgb: number[]): number => {
      const [r, g, b] = rgb.map(val => {
        val = val / 255;
        return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    
    const bgLuminance = getLuminance(bgRGB);
    const htmlLuminance = getLuminance(htmlRGB);
    const avgLuminance = (bgLuminance + htmlLuminance) / 2;
    
    // Also check for dark mode classes/attributes
    const hasDarkClass = html.classList.contains('dark') || 
                        body.classList.contains('dark') ||
                        (html.hasAttribute('data-theme') && html.getAttribute('data-theme') === 'dark');
    
    // Check media query
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Consider dark if luminance is low OR has dark class OR prefers dark
    return avgLuminance < 0.5 || hasDarkClass || prefersDark;
  }

  // Create download button
  function createDownloadButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.id = 'mytube-download-btn';
    button.innerHTML = '📥 Download to MyTube';
    
    const isDark = isDarkTheme();
    
    // Adjust colors based on website theme
    const buttonStyles: ButtonStyles = isDark ? {
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)',
      boxShadowHover: '0 6px 20px rgba(0, 0, 0, 0.5)'
    } : {
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
      boxShadowHover: '0 6px 20px rgba(0, 0, 0, 0.3)'
    };
    
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      background: ${buttonStyles.background};
      color: ${buttonStyles.color};
      border: none;
      padding: 12px 20px;
      border-radius: 25px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: ${buttonStyles.boxShadow};
      transition: all 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-2px)';
      button.style.boxShadow = buttonStyles.boxShadowHover;
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = buttonStyles.boxShadow;
    });

    button.addEventListener('click', handleDownloadClick);

    return button;
  }

  // Handle download button click
  async function handleDownloadClick(): Promise<void> {
    const site = detectSite();
    if (!site) {
      showNotification('Unsupported site', 'error');
      return;
    }

    const videoUrl = site.config.getVideoUrl();
    if (!videoUrl) {
      showNotification('Could not detect video URL', 'error');
      return;
    }

    const button = document.getElementById('mytube-download-btn') as HTMLButtonElement | null;
    if (button) {
      button.disabled = true;
      button.innerHTML = '⏳ Sending...';
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'downloadVideo',
        url: videoUrl,
      }) as { success: boolean; error?: string };

      if (response.success) {
        showNotification('Download queued successfully!', 'success');
      } else {
        showNotification(response.error || 'Failed to queue download', 'error');
      }
    } catch (error) {
      showNotification(
        error instanceof Error ? error.message : 'Failed to connect to extension',
        'error'
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = '📥 Download to MyTube';
      }
    }
  }

  // Show notification
  function showNotification(message: string, type: NotificationType = 'info'): void {
    // Remove existing notification
    const existing = document.getElementById('mytube-notification');
    if (existing) {
      existing.remove();
    }

    // Sanitize message to prevent XSS
    // textContent already escapes HTML, but we validate the input
    if (!message || typeof message !== 'string') {
      message = 'Unknown error';
    }
    
    // Remove any potentially dangerous characters
    const sanitizedMessage = message.replace(/[<>]/g, '');

    const notification = document.createElement('div');
    notification.id = 'mytube-notification';
    notification.textContent = sanitizedMessage;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10001;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
      animation: slideIn 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 300px;
      ${type === 'success' ? 'background: #10b981;' : ''}
      ${type === 'error' ? 'background: #ef4444;' : ''}
      ${type === 'info' ? 'background: #3b82f6;' : ''}
    `;

    // Add animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Auto remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // Initialize button on page load
  function init(): void {
    const site = detectSite();
    if (!site || !site.config.shouldShowButton()) {
      return;
    }

    // Wait for page to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addButton);
    } else {
      addButton();
    }

    // Re-add button on navigation (for SPAs like YouTube)
    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(() => {
          if (site.config.shouldShowButton()) {
            addButton();
          } else {
            removeButton();
          }
        }, 1000);
      }
    }).observe(document, { subtree: true, childList: true });
  }

  function addButton(): void {
    // Don't add if already exists
    if (document.getElementById('mytube-download-btn')) {
      return;
    }

    const site = detectSite();
    if (!site || !site.config.shouldShowButton()) {
      return;
    }

    const button = createDownloadButton();
    document.body.appendChild(button);
  }

  function removeButton(): void {
    const button = document.getElementById('mytube-download-btn');
    if (button) {
      button.remove();
    }
  }

  // Start initialization
  init();
})();