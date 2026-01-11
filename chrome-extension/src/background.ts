// Background service worker for MyTube Downloader extension

interface DownloadVideoMessage {
  action: 'downloadVideo';
  url: string;
  serverUrl?: string;
}

interface TestConnectionMessage {
  action: 'testConnection';
  serverUrl: string;
}

interface GetTranslationsMessage {
  action: 'getTranslations';
}

type MessageRequest = DownloadVideoMessage | TestConnectionMessage | GetTranslationsMessage;

interface MessageResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  lang?: string;
}

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((
  request: MessageRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): boolean => {
  if (request.action === 'downloadVideo') {
    handleDownload(request.url, request.serverUrl)
      .then(result => {
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true; // Indicates we will send a response asynchronously
  }

  if (request.action === 'testConnection') {
    testConnection(request.serverUrl)
      .then(result => {
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true; // Indicates we will send a response asynchronously
  }

  if (request.action === 'getTranslations') {
    // Get browser language and return appropriate translations
    const lang = chrome.i18n?.getUILanguage?.() || navigator.language || 'en';
    const langCode = lang.split('-')[0].toLowerCase();
    const languageMap: Record<string, string> = {
      'en': 'en', 'zh': 'zh', 'de': 'de', 'es': 'es', 'fr': 'fr',
      'ja': 'ja', 'ko': 'ko', 'pt': 'pt', 'ru': 'ru', 'ar': 'ar'
    };
    const normalizedLang = languageMap[langCode] || 'en';
    
    // For now, return language code - content script will use English as fallback
    // Full translation support for content script would require more complex setup
    sendResponse({ success: true, lang: normalizedLang });
    return true;
  }

  // Return false if we don't handle the message
  return false;
});

/**
 * Test connection to MyTube server
 */
async function testConnection(serverUrl: string): Promise<{ connected: boolean; message: string }> {
  if (!serverUrl) {
    throw new Error('Server URL is required');
  }

  // Normalize URL - remove trailing slash
  const normalizedUrl = serverUrl.replace(/\/+$/, '');
  const testUrl = `${normalizedUrl}/api/settings`;

  try {
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    await response.json();
    return { connected: true, message: 'Connection successful' };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error('Cannot connect to server. Please check the URL and ensure the server is running.');
    }
    throw error;
  }
}

/**
 * Send download request to MyTube server
 */
async function handleDownload(videoUrl: string, serverUrl?: string): Promise<{ message: string; downloadId?: string }> {
  if (!videoUrl) {
    throw new Error('Video URL is required');
  }

  // Get server URL from storage if not provided
  let finalServerUrl = serverUrl;
  if (!finalServerUrl) {
    const result = await chrome.storage.sync.get(['serverUrl']);
    finalServerUrl = result.serverUrl;
  }

  if (!finalServerUrl) {
    throw new Error('Server URL not configured. Please set it in extension options.');
  }

  // Normalize URL - remove trailing slash
  const normalizedUrl = finalServerUrl.replace(/\/+$/, '');
  const downloadUrl = `${normalizedUrl}/api/download`;

  try {
    const response = await fetch(downloadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        youtubeUrl: videoUrl,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `Server responded with status ${response.status}`);
    }

    const data = await response.json();
    return { message: data.message || 'Download queued successfully', downloadId: data.downloadId };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error('Cannot connect to server. Please check the server URL in extension options.');
    }
    throw error;
  }
}