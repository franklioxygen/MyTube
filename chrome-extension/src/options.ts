// Options page script for MyTube Downloader extension

import type { Translations } from './types';

// Wait for DOM to be ready and translations to be loaded
function init() {
  if (window.loadTranslations) {
    window.loadTranslations(() => {
      // Apply translations to static content
      if (window.currentTranslations) {
        const t = window.currentTranslations;
        const h1 = document.querySelector('h1');
        if (h1) h1.textContent = t.mytubeDownloader || 'MyTube Downloader';
        
        const subtitle = document.querySelector('.subtitle');
        if (subtitle) subtitle.textContent = t.configureConnection || 'Configure your MyTube server connection';
        
        const label = document.querySelector('label strong');
        if (label) label.textContent = t.serverUrl || 'MyTube Server URL';
        
        const hint = document.querySelector('.hint');
        if (hint) hint.textContent = t.serverUrlHint || 'Enter the URL of your MyTube server (e.g., http://localhost:3000)';
        
        const testBtn = document.getElementById('testConnectionText');
        if (testBtn) testBtn.textContent = t.testConnection || 'Test Connection';
        
        const saveBtn = document.getElementById('saveSettings');
        if (saveBtn) saveBtn.textContent = t.saveSettings || 'Save Settings';
        
        const footer = document.querySelector('footer p');
        if (footer) footer.textContent = t.footerText || 'After configuring, visit video websites to download videos with one click!';
      }
      
      // Initialize options page
      initializeOptions();
    });
  } else {
    // Fallback if translations not loaded
    initializeOptions();
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
  const testConnectionBtn = document.getElementById('testConnection') as HTMLButtonElement | null;
  const testConnectionText = document.getElementById('testConnectionText');
  const testConnectionSpinner = document.getElementById('testConnectionSpinner');
  const testResult = document.getElementById('testResult');
  const saveSettingsBtn = document.getElementById('saveSettings') as HTMLButtonElement | null;
  const statusMessage = document.getElementById('statusMessage');

  if (!serverUrlInput || !testConnectionBtn || !testConnectionText || !testConnectionSpinner || 
      !testResult || !saveSettingsBtn || !statusMessage) {
    console.error('Required DOM elements not found');
    return;
  }

  // Load saved settings
  const result = await chrome.storage.sync.get(['serverUrl']);
  if (result.serverUrl) {
    serverUrlInput.value = result.serverUrl;
  }

  // Test connection
  testConnectionBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.trim();
    
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
      }) as { success: boolean; error?: string };

      if (response.success) {
        showTestResult(window.currentTranslations?.connectionSuccess || '✓ Connection successful!', 'success');
      } else {
        const errorMsg = response.error || (window.currentTranslations?.connectionFailed || 'Connection failed');
        showTestResult(`✗ ${errorMsg.replace('{error}', response.error || '')}`, 'error');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : (window.currentTranslations?.connectionFailed || 'Failed to test connection');
      showTestResult(`✗ ${errorMsg.replace('{error}', error instanceof Error ? error.message : '')}`, 'error');
    } finally {
      testConnectionBtn.disabled = false;
      testConnectionText.textContent = window.currentTranslations?.testConnection || 'Test Connection';
      testConnectionSpinner.classList.add('hidden');
    }
  });

  // Save settings
  saveSettingsBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.trim();

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
      await chrome.storage.sync.set({ serverUrl: serverUrl });
      showStatus(window.currentTranslations?.settingsSaved || 'Settings saved successfully!', 'success');
    } catch (error) {
      const errorMsg = (window.currentTranslations?.settingsError || 'Error saving settings: {error}').replace('{error}', error instanceof Error ? error.message : String(error));
      showStatus(errorMsg, 'error');
    }
  });

  // Allow Enter key to save
  serverUrlInput.addEventListener('keypress', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveSettingsBtn.click();
    }
  });

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