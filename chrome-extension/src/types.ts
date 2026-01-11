// Shared type definitions for Chrome Extension

export interface Translations {
  // Popup
  mytube: string;
  downloadCurrentPage: string;
  worksOnAllSites: string;
  checkingServer: string;
  serverConnected: string;
  serverDisconnected: string;
  settings: string;
  
  // Options
  mytubeDownloader: string;
  configureConnection: string;
  serverUrl: string;
  serverUrlHint: string;
  testConnection: string;
  testing: string;
  saveSettings: string;
  settingsSaved: string;
  settingsError: string;
  connectionSuccess: string;
  connectionFailed: string;
  footerText: string;
  
  // Content Script
  downloadToMytube: string;
  sending: string;
  downloadQueued: string;
  downloadFailed: string;
  unsupportedSite: string;
  couldNotDetectUrl: string;
  failedToConnect: string;
}

declare global {
  interface Window {
    currentTranslations?: Translations;
    loadTranslations?: (callback?: () => void) => void;
    getBrowserLanguage?: () => string;
    normalizeLanguage?: (lang: string) => string;
    t?: (key: keyof Translations, params?: Record<string, string>) => string;
  }
}