// Popup script for MyTube Downloader extension

import type { Translations } from './types';

function getButtonElement(id: string): HTMLButtonElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLButtonElement ? element : null;
}

function getElement(id: string): HTMLElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLElement ? element : null;
}

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
      void initializePopup();
    });
  } else {
    // Fallback if translations not loaded
    void initializePopup();
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function initializePopup(): Promise<void> {
  const downloadCurrentPageButton = getButtonElement('downloadCurrentPage');
  const openOptionsButton = getButtonElement('openOptions');
  const serverStatus = getElement('serverStatus');
  const serverStatusText = getElement('serverStatusText');

  if (!downloadCurrentPageButton || !openOptionsButton || !serverStatus || !serverStatusText) {
    console.error('Required DOM elements not found');
    return;
  }

  const serverStatusIndicator = serverStatus;
  const serverStatusLabel = serverStatusText;

  // Check server status
  await checkServerStatus();

  // Open options page
  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Download current page
  const handleDownloadCurrentPage = async (): Promise<void> => {
    downloadCurrentPageButton.disabled = true;
    downloadCurrentPageButton.textContent =
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
      const result = await chrome.storage.sync.get(['serverUrl', 'apiKey']);
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
        apiKey: result.apiKey ?? null,
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
      downloadCurrentPageButton.disabled = false;
      downloadCurrentPageButton.textContent =
        window.currentTranslations?.downloadCurrentPage ||
        'Download Current Page';
    }
  };

  downloadCurrentPageButton.addEventListener('click', () => {
    void handleDownloadCurrentPage();
  });

  async function checkServerStatus(): Promise<void> {
    serverStatusIndicator.className = 'server-status checking';
    serverStatusLabel.textContent =
      window.currentTranslations?.checkingServer || 'Checking server...';

    try {
      const result = await chrome.storage.sync.get(['serverUrl', 'apiKey']);

      if (!result.serverUrl) {
        serverStatusIndicator.className = 'server-status disconnected';
        serverStatusLabel.textContent =
          '⚠ ' +
          (window.currentTranslations?.serverDisconnected ||
            'Server URL not configured');
        return;
      }

      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        serverUrl: result.serverUrl,
        apiKey: result.apiKey ?? null,
      }) as { success: boolean; error?: string };

      if (response.success) {
        serverStatusIndicator.className = 'server-status connected';
        serverStatusLabel.textContent =
          '✓ ' +
          (window.currentTranslations?.serverConnected || 'Server connected');
      } else {
        serverStatusIndicator.className = 'server-status disconnected';
        serverStatusLabel.textContent =
          '✗ ' +
          (window.currentTranslations?.serverDisconnected ||
            'Server disconnected');
      }
    } catch (error) {
      serverStatusIndicator.className = 'server-status disconnected';
      serverStatusLabel.textContent =
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
