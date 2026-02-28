// Options page script for MyTube Downloader extension

import type { Translations } from './types';

const connectionFailedTemplate = (error: string): string => {
  const template =
    window.currentTranslations?.connectionFailed || '✗ {error}';
  return template.includes('{error}')
    ? template.replace('{error}', error)
    : `✗ ${error}`;
};

// Wait for DOM to be ready and translations to be loaded
function init(): void {
  if (window.loadTranslations) {
    window.loadTranslations(() => {
      if (window.currentTranslations) {
        applyStaticTranslations(window.currentTranslations);
      }
      initializeOptions();
    });
    return;
  }

  // Fallback if translations are unavailable
  initializeOptions();
}

function applyStaticTranslations(t: Translations): void {
  const h1 = document.querySelector('h1');
  if (h1) h1.textContent = t.mytubeDownloader || 'MyTube Downloader';

  const subtitle = document.querySelector('.subtitle');
  if (subtitle) {
    subtitle.textContent =
      t.configureConnection || 'Configure your MyTube server connection';
  }

  const serverUrlLabel = document.getElementById('serverUrlLabel');
  if (serverUrlLabel) {
    serverUrlLabel.textContent = t.serverUrl || 'MyTube Server URL';
  }

  const serverUrlHint = document.getElementById('serverUrlHint');
  if (serverUrlHint) {
    serverUrlHint.textContent =
      t.serverUrlHint ||
      'Enter the URL of your MyTube server (e.g., http://localhost:3000)';
  }

  const apiKeyLabel = document.getElementById('apiKeyLabel');
  if (apiKeyLabel) {
    apiKeyLabel.textContent = t.apiKey || 'API Key (Optional)';
  }

  const apiKeyHint = document.getElementById('apiKeyHint');
  if (apiKeyHint) {
    apiKeyHint.textContent =
      t.apiKeyHint ||
      'Paste your API key from MyTube Security Settings. Used only for download requests.';
  }

  const testBtnText = document.getElementById('testConnectionText');
  if (testBtnText) testBtnText.textContent = t.testConnection || 'Test Connection';

  const saveBtn = document.getElementById('saveSettings');
  if (saveBtn) saveBtn.textContent = t.saveSettings || 'Save Settings';

  const footer = document.querySelector('footer p');
  if (footer) {
    footer.textContent =
      t.footerText ||
      'After configuring, visit video websites to download videos with one click!';
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function initializeOptions(): Promise<void> {
  const serverUrlInput = document.getElementById('serverUrl') as HTMLInputElement | null;
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
  const testConnectionBtn = document.getElementById('testConnection') as HTMLButtonElement | null;
  const testConnectionText = document.getElementById('testConnectionText');
  const testConnectionSpinner = document.getElementById('testConnectionSpinner');
  const testResult = document.getElementById('testResult');
  const saveSettingsBtn = document.getElementById('saveSettings') as HTMLButtonElement | null;
  const statusMessage = document.getElementById('statusMessage');

  if (!serverUrlInput || !apiKeyInput || !testConnectionBtn || !testConnectionText || !testConnectionSpinner || 
      !testResult || !saveSettingsBtn || !statusMessage) {
    console.error('Required DOM elements not found');
    return;
  }

  // Load saved settings
  const result = await chrome.storage.sync.get(['serverUrl', 'apiKey']);
  if (result.serverUrl) {
    serverUrlInput.value = result.serverUrl;
  }
  if (typeof result.apiKey === 'string') {
    apiKeyInput.value = result.apiKey;
  }

  // Test connection
  testConnectionBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    
    if (!serverUrl) {
      showTestResult('Please enter a server URL', 'error');
      return;
    }

    // Validate URL format
    try {
      new URL(serverUrl);
    } catch (e) {
      showTestResult('Invalid URL format. Please enter a valid URL (e.g., http://localhost:3000)', 'error');
      return;
    }

    // Show loading state
    testConnectionBtn.disabled = true;
    testConnectionText.textContent = window.currentTranslations?.testing || 'Testing...';
    testConnectionSpinner.classList.remove('hidden');
    testResult.classList.add('hidden');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        serverUrl: serverUrl,
        apiKey: apiKey || undefined,
      }) as { success: boolean; error?: string };

      if (response.success) {
        showTestResult(window.currentTranslations?.connectionSuccess || '✓ Connection successful!', 'success');
      } else {
        showTestResult(
          connectionFailedTemplate(response.error || 'Connection failed'),
          'error'
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to test connection';
      showTestResult(connectionFailedTemplate(message), 'error');
    } finally {
      testConnectionBtn.disabled = false;
      testConnectionText.textContent = window.currentTranslations?.testConnection || 'Test Connection';
      testConnectionSpinner.classList.add('hidden');
    }
  });

  // Save settings
  saveSettingsBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    if (!serverUrl) {
      showStatus('Please enter a server URL', 'error');
      return;
    }

    // Validate URL format
    try {
      new URL(serverUrl);
    } catch (e) {
      showStatus('Invalid URL format. Please enter a valid URL', 'error');
      return;
    }

    try {
      if (apiKey.length > 0) {
        await chrome.storage.sync.set({ serverUrl: serverUrl, apiKey: apiKey });
      } else {
        await chrome.storage.sync.set({ serverUrl: serverUrl });
        await chrome.storage.sync.remove('apiKey');
      }
      showStatus(window.currentTranslations?.settingsSaved || 'Settings saved successfully!', 'success');
    } catch (error) {
      const errorMsg = (window.currentTranslations?.settingsError || 'Error saving settings: {error}').replace('{error}', error instanceof Error ? error.message : String(error));
      showStatus(errorMsg, 'error');
    }
  });

  // Allow Enter key to save
  const handleEnterToSave = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveSettingsBtn.click();
    }
  };
  serverUrlInput.addEventListener('keydown', handleEnterToSave);
  apiKeyInput.addEventListener('keydown', handleEnterToSave);

  function showTestResult(message: string, type: 'success' | 'error'): void {
    if (!testResult) return;
    testResult.textContent = message;
    testResult.className = `test-result ${type}`;
    testResult.classList.remove('hidden');
  }

  function showStatus(message: string, type: 'success' | 'error'): void {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.classList.remove('hidden');

    // Auto-hide after 3 seconds
    setTimeout(() => {
      if (statusMessage) {
        statusMessage.classList.add('hidden');
      }
    }, 3000);
  }
}
