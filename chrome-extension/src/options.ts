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
      void initializeOptions();
    });
    return;
  }

  // Fallback if translations are unavailable
  void initializeOptions();
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

function getInputElement(id: string): HTMLInputElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element : null;
}

function getButtonElement(id: string): HTMLButtonElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLButtonElement ? element : null;
}

function getRequiredElement(id: string): HTMLElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLElement ? element : null;
}

async function initializeOptions(): Promise<void> {
  const serverUrlField = getInputElement('serverUrl');
  const apiKeyField = getInputElement('apiKey');
  const testConnectionButton = getButtonElement('testConnection');
  const testConnectionLabel = getRequiredElement('testConnectionText');
  const testConnectionSpinner = getRequiredElement('testConnectionSpinner');
  const testResult = getRequiredElement('testResult');
  const saveSettingsButton = getButtonElement('saveSettings');
  const statusMessage = getRequiredElement('statusMessage');

  if (!serverUrlField || !apiKeyField || !testConnectionButton || !testConnectionLabel || !testConnectionSpinner ||
      !testResult || !saveSettingsButton || !statusMessage) {
    console.error('Required DOM elements not found');
    return;
  }

  // Load saved settings
  const result = await chrome.storage.sync.get(['serverUrl', 'apiKey']);
  if (result.serverUrl) {
    serverUrlField.value = result.serverUrl;
  }
  if (typeof result.apiKey === 'string') {
    apiKeyField.value = result.apiKey;
  }

  // Test connection
  const handleTestConnection = async (): Promise<void> => {
    const serverUrl = serverUrlField.value.trim();
    const apiKey = apiKeyField.value.trim();

    if (!serverUrl) {
      showTestResult('Please enter a server URL', 'error');
      return;
    }

    // Validate URL format
    try {
      new URL(serverUrl);
    } catch {
      showTestResult('Invalid URL format. Please enter a valid URL (e.g., http://localhost:3000)', 'error');
      return;
    }

    // Show loading state
    testConnectionButton.disabled = true;
    testConnectionLabel.textContent = window.currentTranslations?.testing || 'Testing...';
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
      testConnectionButton.disabled = false;
      testConnectionLabel.textContent = window.currentTranslations?.testConnection || 'Test Connection';
      testConnectionSpinner.classList.add('hidden');
    }
  };

  testConnectionButton.addEventListener('click', () => {
    void handleTestConnection();
  });

  // Save settings
  const handleSaveSettings = async (): Promise<void> => {
    const serverUrl = serverUrlField.value.trim();
    const apiKey = apiKeyField.value.trim();

    if (!serverUrl) {
      showStatus('Please enter a server URL', 'error');
      return;
    }

    // Validate URL format
    try {
      new URL(serverUrl);
    } catch {
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
  };

  saveSettingsButton.addEventListener('click', () => {
    void handleSaveSettings();
  });

  // Allow Enter key to save
  const handleEnterToSave = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveSettingsButton.click();
    }
  };
  serverUrlField.addEventListener('keydown', handleEnterToSave);
  apiKeyField.addEventListener('keydown', handleEnterToSave);

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
      statusMessage.classList.add('hidden');
    }, 3000);
  }
}
