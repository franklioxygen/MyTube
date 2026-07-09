import { useCallback, useState } from 'react';

export const DOWNLOAD_AUDIO_ONLY_STORAGE_KEY = 'mytube:download-audio-only';

function readPreference(): boolean {
  try {
    return localStorage.getItem(DOWNLOAD_AUDIO_ONLY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useDownloadAudioOnlyPreference(): [boolean, (value: boolean) => void] {
  const [initialValue] = useState(readPreference);
  const persist = useCallback((value: boolean) => {
    try {
      localStorage.setItem(DOWNLOAD_AUDIO_ONLY_STORAGE_KEY, String(value));
    } catch {
      // localStorage may be unavailable; the current download still succeeds.
    }
  }, []);

  return [initialValue, persist];
}
