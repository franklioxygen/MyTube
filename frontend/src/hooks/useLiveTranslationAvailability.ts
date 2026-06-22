import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/apiClient';
import { LiveTranslationErrorCode } from '../utils/liveTranslationProtocol';

export interface LiveTranslationAvailability {
  enabled: boolean;
  available: boolean;
  canUse: boolean;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  apiKeyConfigured: boolean;
  requiresAdmin: boolean;
  reason: LiveTranslationErrorCode | 'target_language_missing' | 'unsupported_model' | null;
}

const DEFAULT_AVAILABILITY: LiveTranslationAvailability = {
  enabled: false,
  available: false,
  canUse: false,
  model: '',
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  apiKeyConfigured: false,
  requiresAdmin: false,
  reason: 'feature_disabled',
};

/**
 * Fetches the secret-free live translation availability snapshot the player uses
 * to decide whether to show / enable the Live Translate button.
 */
export function useLiveTranslationAvailability() {
  const { isAuthenticated, userRole, loginRequired } = useAuth();

  return useQuery<LiveTranslationAvailability>({
    // The response is requester-dependent (canUse/reason/apiKeyConfigured differ
    // by role and login state), so scope the cache by role + login state. This
    // prevents reusing a stale entry across an auth change (e.g. visitor -> admin)
    // within the staleTime window.
    queryKey: ['liveTranslationConfig', userRole, loginRequired],
    queryFn: async () => {
      const res = await api.get('/live-translation/config');
      return res.data as LiveTranslationAvailability;
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
    placeholderData: DEFAULT_AVAILABILITY,
  });
}

export { DEFAULT_AVAILABILITY };
