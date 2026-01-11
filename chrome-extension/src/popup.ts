// Popup script for MyTube Downloader extension

import type { Translations } from './types';

// Wait for DOM to be ready and translations to be loaded
function init() {
  if (window.loadTranslations) {
    window.loadTranslations(() => {
      // Apply translations to static content
      if (window.currentTranslations) {
        const t = window.currentTranslations;
        const h1 = document.querySelector('h1');
        if (h1) h1.textContent = t.mytube || 'MyTube';
        
        const downloadBtn = document.getElementById('downloadCurrentPage');
        if (downloadBtn) {
          downloadBtn.textContent = t.downloadCurrentPage || 'Download Current Page';
        }
        
        const hint = document.querySelector('.hint');
        if (hint) hint.textContent = t.worksOnAllSites || 'Works on all yt-dlp supported sites';
        
        const openOptionsBtn = document.getElementById('openOptions');
        if (openOptionsBtn) {
          openOptionsBtn.textContent = '⚙️ ' + (t.settings || 'Settings');
        }
      }

      // Initialize popup
      initializePopup();
    });
  } else {
    // Fallback if translations not loaded
    initializePopup();
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function initializePopup(): Promise<void> {
  const downloadCurrentPageBtn = document.getElementById('downloadCurrentPage') as HTMLButtonElement | null;
  const openOptionsBtn = document.getElementById('openOptions') as HTMLButtonElement | null;
  const serverStatus = document.getElementById('serverStatus');
  const serverStatusText = document.getElementById('serverStatusText');

  if (!downloadCurrentPageBtn || !openOptionsBtn || !serverStatus || !serverStatusText) {
    console.error('Required DOM elements not found');
    return;
  }

  // Check server status
  await checkServerStatus();

  // Open options page
  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Download current page
  downloadCurrentPageBtn.addEventListener('click', async () => {
    downloadCurrentPageBtn.disabled = true;
    downloadCurrentPageBtn.textContent =
      window.currentTranslations?.testing || 'Processing...';

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.url) {
        showError('Could not get current page URL');
        return;
      }

      // All yt-dlp supported sites are supported via the backend
      // The check is mainly for user feedback, but the backend will handle any valid URL

      // Get server URL
      const result = await chrome.storage.sync.get(['serverUrl']);
      if (!result.serverUrl) {
        showError(
          window.currentTranslations?.serverDisconnected ||
            'Server URL not configured. Please set it in settings.'
        );
        chrome.runtime.openOptionsPage();
        return;
      }

      // Send download request
      const response = await chrome.runtime.sendMessage({
        action: 'downloadVideo',
        url: tab.url,
        serverUrl: result.serverUrl,
      }) as { success: boolean; error?: string };

      if (response.success) {
        showSuccess(
          window.currentTranslations?.downloadQueued ||
            'Download queued successfully!'
        );
        // Close popup after a delay
        setTimeout(() => {
          window.close();
        }, 1500);
      } else {
        showError(
          response.error ||
            window.currentTranslations?.downloadFailed ||
            'Failed to queue download'
        );
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      downloadCurrentPageBtn.disabled = false;
      downloadCurrentPageBtn.textContent =
        window.currentTranslations?.downloadCurrentPage ||
        'Download Current Page';
    }
  });

  async function checkServerStatus(): Promise<void> {
    if (!serverStatus || !serverStatusText) return;
    
    serverStatus.className = 'server-status checking';
    serverStatusText.textContent =
      window.currentTranslations?.checkingServer || 'Checking server...';

    try {
      const result = await chrome.storage.sync.get(['serverUrl']);

      if (!result.serverUrl) {
        if (!serverStatus || !serverStatusText) return;
        serverStatus.className = 'server-status disconnected';
        serverStatusText.textContent =
          '⚠ ' +
          (window.currentTranslations?.serverDisconnected ||
            'Server URL not configured');
        return;
      }

      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        serverUrl: result.serverUrl,
      }) as { success: boolean; error?: string };

      if (!serverStatus || !serverStatusText) return;
      
      if (response.success) {
        serverStatus.className = 'server-status connected';
        serverStatusText.textContent =
          '✓ ' +
          (window.currentTranslations?.serverConnected || 'Server connected');
      } else {
        serverStatus.className = 'server-status disconnected';
        serverStatusText.textContent =
          '✗ ' +
          (window.currentTranslations?.serverDisconnected ||
            'Server disconnected');
      }
    } catch (error) {
      if (!serverStatus || !serverStatusText) return;
      serverStatus.className = 'server-status disconnected';
      serverStatusText.textContent =
        '✗ ' +
        (window.currentTranslations?.serverDisconnected ||
          'Error checking server');
    }
  }

  function showError(message: string): void {
    console.error(message);
    alert(message);
  }

  function showSuccess(message: string): void {
    console.log(message);
    alert(message);
  }
}