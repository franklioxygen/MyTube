// Background service worker for MyTube Downloader extension

interface DownloadVideoMessage {
  action: 'downloadVideo';
  url: string;
  serverUrl?: string;
  apiKey?: string | null;
}

interface TestConnectionMessage {
  action: 'testConnection';
  serverUrl: string;
  apiKey?: string | null;
}

interface GetTranslationsMessage {
  action: 'getTranslations';
}

type MessageRequest =
  | DownloadVideoMessage
  | TestConnectionMessage
  | GetTranslationsMessage;

interface MessageResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  lang?: string;
}

const SUPPORTED_LANGUAGE_CODES = new Set([
  'en',
  'zh',
  'de',
  'es',
  'fr',
  'ja',
  'ko',
  'pt',
  'ru',
  'ar',
]);
const SUPPORTED_SERVER_PROTOCOLS = new Set(['http:', 'https:']);

const normalizeApiKey = (apiKey?: string | null): string | undefined => {
  if (typeof apiKey !== 'string') {
    return undefined;
  }

  const trimmed = apiKey.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const withApiKeyHeader = (
  headers: Record<string, string>,
  apiKey: string | undefined | null
): Record<string, string> => {
  if (apiKey) {
    return { ...headers, 'X-API-Key': apiKey };
  }
  return headers;
};

const parseErrorMessage = async (
  response: Response,
  fallbackMessage: string
): Promise<string> => {
  const errorData = await response.json().catch(() => ({}));
  return errorData.message || errorData.error || fallbackMessage;
};

const parseServerBaseUrl = (serverUrl: string): URL => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(serverUrl.trim());
  } catch {
    throw new Error('Server URL is invalid.');
  }

  if (!SUPPORTED_SERVER_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error('Server URL must use http or https.');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Server URL must not contain credentials.');
  }

  parsedUrl.search = '';
  parsedUrl.hash = '';
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');
  if (!parsedUrl.pathname.endsWith('/')) {
    parsedUrl.pathname = `${parsedUrl.pathname}/`;
  }

  return parsedUrl;
};

const buildServerEndpoint = (
  serverUrl: string,
  endpointPath: string
): string => {
  const baseUrl = parseServerBaseUrl(serverUrl);
  const normalizedEndpointPath = endpointPath.replace(/^\/+/, '');
  return new URL(normalizedEndpointPath, baseUrl).toString();
};

const getUiLanguageCode = (): string => {
  const browserLanguage = chrome.i18n.getUILanguage() || navigator.language || 'en';
  const [languageCode = 'en'] = browserLanguage.split('-');
  return SUPPORTED_LANGUAGE_CODES.has(languageCode) ? languageCode : 'en';
};

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((
  request: MessageRequest,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): boolean => {
  switch (request.action) {
    case 'downloadVideo':
      handleDownload(request.url, request.serverUrl, request.apiKey)
        .then(result => {
          sendResponse({ success: true, data: result });
        })
        .catch(error => {
          sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
        });
      return true;
    case 'testConnection':
      testConnection(request.serverUrl, request.apiKey)
        .then(result => {
          sendResponse({ success: true, data: result });
        })
        .catch(error => {
          sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
        });
      return true;
    case 'getTranslations':
      // For now, return language code - content script will use English as fallback.
      sendResponse({ success: true, lang: getUiLanguageCode() });
      return true;
  }

  // Return false if we don't handle the message
  return false;
});

/**
 * Test connection to MyTube server.
 * API key mode is validated through POST /api/download because API keys
 * are intentionally restricted to download task creation only.
 */
async function testConnection(
  serverUrl: string,
  apiKey?: string | null
): Promise<{ connected: boolean; message: string }> {
  if (!serverUrl) {
    throw new Error('Server URL is required');
  }

  const normalizedApiKey = normalizeApiKey(apiKey);

  try {
    if (normalizedApiKey) {
      const downloadRequest = new Request(buildServerEndpoint(serverUrl, 'api/download'), {
        method: 'POST',
        headers: withApiKeyHeader(
          {
            'Content-Type': 'application/json',
          },
          normalizedApiKey
        ),
        body: JSON.stringify({}),
      });
      const response = await fetch(downloadRequest);

      if (response.ok || response.status === 400) {
        return { connected: true, message: 'Connection successful' };
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error('API key is invalid or API key authentication is disabled on server.');
      }

      throw new Error(
        await parseErrorMessage(
          response,
          `Server responded with status ${response.status}`
        )
      );
    }

    const settingsRequest = new Request(buildServerEndpoint(serverUrl, 'api/settings'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const response = await fetch(settingsRequest);

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
async function handleDownload(
  videoUrl: string,
  serverUrl?: string,
  apiKey?: string | null
): Promise<{ message: string; downloadId?: string }> {
  if (!videoUrl) {
    throw new Error('Video URL is required');
  }

  let finalServerUrl = typeof serverUrl === 'string' ? serverUrl.trim() : '';
  let finalApiKey = normalizeApiKey(apiKey);

  // Get values from storage when not provided by caller
  if (!finalServerUrl || typeof apiKey === 'undefined') {
    const result = await chrome.storage.sync.get(['serverUrl', 'apiKey']);
    if (!finalServerUrl && typeof result.serverUrl === 'string') {
      finalServerUrl = result.serverUrl.trim();
    }
    if (typeof apiKey === 'undefined') {
      finalApiKey = normalizeApiKey(result.apiKey);
    }
  }

  if (!finalServerUrl) {
    throw new Error('Server URL not configured. Please set it in extension options.');
  }

  const downloadUrl = buildServerEndpoint(finalServerUrl, 'api/download');

  // /api/check-video-download is not allowed for API key auth.
  if (!finalApiKey) {
    try {
      const checkUrl = buildServerEndpoint(finalServerUrl, 'api/check-video-download');
      const checkUrlWithQuery = new URL(checkUrl);
      checkUrlWithQuery.searchParams.set('url', videoUrl);
      const checkRequest = new Request(checkUrlWithQuery.toString(), {
        method: 'GET',
      });
      const checkResponse = await fetch(checkRequest);

      if (checkResponse.ok) {
        const data = await checkResponse.json();
        // If video exists, return success immediately without downloading again
        if (data.found && data.status === 'exists') {
          return { message: 'Video already downloaded', downloadId: data.videoId };
        }
      }
    } catch (error) {
      // Ignore check errors and proceed to download attempt
      console.warn('Failed to check existing download:', error);
    }
  }

  try {
    const downloadRequest = new Request(downloadUrl, {
      method: 'POST',
      headers: withApiKeyHeader(
        {
          'Content-Type': 'application/json',
        },
        finalApiKey
      ),
      body: JSON.stringify({
        youtubeUrl: videoUrl,
      }),
    });
    const response = await fetch(downloadRequest);

    if (!response.ok) {
      throw new Error(
        await parseErrorMessage(
          response,
          `Server responded with status ${response.status}`
        )
      );
    }

    const data = await response.json();
    // Refresh status immediately
    void fetchDownloadStatus();
    return { message: data.message || 'Download queued successfully', downloadId: data.downloadId };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error('Cannot connect to server. Please check the server URL in extension options.');
    }
    throw error;
  }
}

/**
 * Fetch download status and update badge
 */
async function fetchDownloadStatus(): Promise<void> {
  const result = await chrome.storage.sync.get(['serverUrl', 'apiKey']);
  const serverUrl = result.serverUrl;
  const apiKey = normalizeApiKey(result.apiKey);

  if (!serverUrl || apiKey) {
    // API key mode can only access POST /api/download, so status polling is unavailable.
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const statusUrl = buildServerEndpoint(serverUrl, 'api/download-status');

  try {
    const statusRequest = new Request(statusUrl, {
      method: 'GET',
    });
    const response = await fetch(statusRequest);

    if (response.ok) {
      const data = await response.json();
      const activeCount = (data.activeDownloads?.length || 0) + (data.queuedDownloads?.length || 0);

      if (activeCount > 0) {
        chrome.action.setBadgeText({ text: String(activeCount) });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' }); // Green color
      } else {
        chrome.action.setBadgeText({ text: '' });
      }
    } else {
      // Failed to fetch status (maybe auth error or server down) - clear badge
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    // Connection error - clear badge
    chrome.action.setBadgeText({ text: '' });
  }
}

// Start polling alarm
chrome.alarms.create('pollDownloadStatus', {
  periodInMinutes: 0.05 // every 3 seconds (approx) - Chrome limits alarms to 1 min usually but dev builds allow frequent
});

// Fallback to setInterval if alarms are too slow (sometimes alarms are throttled)
// But strictly speaking, background service workers might sleep.
// For MV3, alarms are preferred.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollDownloadStatus') {
    void fetchDownloadStatus();
  }
});

// Also poll on startup
chrome.runtime.onStartup.addListener(() => {
  void fetchDownloadStatus();
});

// Poll when messages are received (interaction happened)
chrome.runtime.onMessage.addListener(() => {
  void fetchDownloadStatus();
  // Return false, we just want to trigger a check
  return false;
});
