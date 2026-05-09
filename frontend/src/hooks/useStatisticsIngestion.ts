import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from './useSettings';
import { api, sendStatisticsEventsWithKeepalive } from '../utils/apiClient';

const SESSION_STORAGE_KEY = 'mytube.statistics.sessionId';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FLUSH_DEBOUNCE_MS = 5_000;
const MAX_BATCH_SIZE = 50;

export type FrontendEventType =
  | 'search_submitted'
  | 'video_play_started'
  | 'video_watch_chunk_recorded';

export interface StatisticsEventInput {
  eventType: FrontendEventType;
  clientOccurredAt?: number;
  relatedEventId?: string | null;
  surface?: string;
  videoId?: string | null;
  collectionId?: string | null;
  platform?: string | null;
  sourceKind?: string | null;
  durationSeconds?: number | null;
  value?: number | null;
  payload?: Record<string, unknown>;
}

interface OutboundEvent extends StatisticsEventInput {
  id: string;
  sessionId: string;
}

let outboundQueue: OutboundEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Lightweight fallback (RFC4122 v4)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface SessionRecord {
  sessionId: string;
  createdAt: number;
  role: string | null;
}

function loadSessionRecord(): SessionRecord | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionRecord | null;
    if (!parsed || typeof parsed.sessionId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSessionRecord(record: SessionRecord): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Ignore quota errors etc.
  }
}

function getOrCreateSessionId(role: string | null): string {
  const existing = loadSessionRecord();
  const now = Date.now();
  if (
    existing &&
    existing.role === role &&
    now - existing.createdAt < SESSION_MAX_AGE_MS
  ) {
    return existing.sessionId;
  }
  const sessionId = generateUUID();
  saveSessionRecord({ sessionId, createdAt: now, role });
  return sessionId;
}

async function flushOutbound(useKeepalive = false): Promise<void> {
  if (outboundQueue.length === 0) return;
  const batch = outboundQueue.slice(0, MAX_BATCH_SIZE);
  outboundQueue = outboundQueue.slice(batch.length);
  const body = {
    events: batch.map(({ sessionId, ...rest }) => ({
      ...rest,
      sessionId,
    })),
  };
  if (useKeepalive) {
    sendStatisticsEventsWithKeepalive(body);
    return;
  }
  try {
    await api.post('/statistics/events', body);
  } catch {
    // Drop the batch on failure to avoid feedback loops; statistics is best-effort.
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushOutbound(false);
  }, FLUSH_DEBOUNCE_MS);
}

export function useStatisticsIngestion(): {
  enabled: boolean;
  recordEvent: (input: StatisticsEventInput) => string | null;
  flushNow: () => void;
  flushKeepalive: () => void;
  sessionId: string;
} {
  const { data: settings } = useSettings();
  const { userRole } = useAuth();

  const enabled = settings?.statisticsEnabled === true;
  const trackVisitor = settings?.statisticsTrackVisitorActivity === true;
  const isVisitor = userRole === 'visitor';
  const ingestionAllowed = enabled && (!isVisitor || trackVisitor);

  const sessionIdRef = useRef<string>('');
  if (!sessionIdRef.current) {
    sessionIdRef.current = getOrCreateSessionId(userRole ?? null);
  }

  // Flush on visibility/pagehide (best-effort).
  useEffect(() => {
    if (!ingestionAllowed) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void flushOutbound(true);
      }
    };
    const handlePageHide = () => {
      void flushOutbound(true);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [ingestionAllowed]);

  // Drop unflushed buffer when role changes; design §7.1.
  useEffect(() => {
    const stored = loadSessionRecord();
    if (stored && stored.role !== (userRole ?? null)) {
      outboundQueue = [];
      const sessionId = generateUUID();
      saveSessionRecord({
        sessionId,
        createdAt: Date.now(),
        role: userRole ?? null,
      });
      sessionIdRef.current = sessionId;
    }
  }, [userRole]);

  const recordEvent = useCallback(
    (input: StatisticsEventInput): string | null => {
      if (!ingestionAllowed) return null;
      const id = generateUUID();
      const event: OutboundEvent = {
        id,
        sessionId: sessionIdRef.current,
        clientOccurredAt: input.clientOccurredAt ?? Date.now(),
        ...input,
      };
      outboundQueue.push(event);
      if (outboundQueue.length >= MAX_BATCH_SIZE) {
        void flushOutbound(false);
      } else {
        scheduleFlush();
      }
      return id;
    },
    [ingestionAllowed]
  );

  const flushNow = useCallback(() => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flushOutbound(false);
  }, []);

  const flushKeepalive = useCallback(() => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flushOutbound(true);
  }, []);

  return {
    enabled: ingestionAllowed,
    recordEvent,
    flushNow,
    flushKeepalive,
    sessionId: sessionIdRef.current,
  };
}
