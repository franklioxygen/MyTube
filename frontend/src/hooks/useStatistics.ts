import { useQuery } from '@tanstack/react-query';
import { api } from '../utils/apiClient';

export interface StatisticsOverview {
  totalVideos: number;
  totalStorageBytes: number;
  activeSubscriptions: number;
  pausedSubscriptions: number;
  activeRssTokens: number;
  collectionCoverage: number;
  subtitleCoverage: number;
  thumbnailCoverage: number;
  downloadSuccessRate: number | null;
  downloadVolumeBytes: number;
  netNewVideos: number;
  watchSecondsLastRange: number;
  alerts: Array<{
    key: string;
    severity: string;
    title: string;
    detail?: string;
  }>;
  diskRunway?: {
    status: string;
    daysRemaining?: number;
    freeBytes?: number;
    netDailyBytes?: number;
    rootPath?: string;
    volumes?: Array<{
      rootPath: string;
      freeBytes: number;
      daysRemaining: number;
    }>;
  };
  statisticsEnabled?: boolean;
}

export interface StatisticsHealth {
  rollup: { running: boolean; lastRunAt: number | null };
  dirtyDayCount: number;
  sealedDayCount: number;
  trailingHour: {
    accepted: number;
    dropped: number;
    error: number;
    sealedDayDrop: number;
  };
  warning: boolean;
}

export interface StatisticsTimeseriesPoint {
  day: string;
  count: number;
  sum: number;
}

export interface StatisticsRankingRow {
  key: string;
  label: string;
  count: number;
  sum: number;
  meta?: Record<string, unknown>;
}

interface StatisticsQueryOptions {
  enabled?: boolean;
}

export const useStatisticsOverview = (
  rangeDays = 30,
  options: StatisticsQueryOptions = {}
) =>
  useQuery({
    queryKey: ['statistics', 'overview', rangeDays],
    queryFn: async (): Promise<StatisticsOverview> => {
      const response = await api.get(`/statistics/overview?range=${rangeDays}`);
      return response.data as StatisticsOverview;
    },
    enabled: options.enabled ?? true,
    refetchOnWindowFocus: false,
  });

export const useStatisticsHealth = (
  options: StatisticsQueryOptions = {}
) =>
  useQuery({
    queryKey: ['statistics', 'health'],
    queryFn: async (): Promise<StatisticsHealth> => {
      const response = await api.get(`/statistics/health`);
      return response.data as StatisticsHealth;
    },
    enabled: options.enabled ?? true,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

export const useStatisticsTimeseries = (
  metric: string,
  rangeDays = 30,
  filters: { platform?: string; actorRole?: string; sourceKind?: string } = {},
  options: StatisticsQueryOptions = {}
) =>
  useQuery({
    queryKey: ['statistics', 'timeseries', metric, rangeDays, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('range', String(rangeDays));
      if (filters.platform) params.set('platform', filters.platform);
      if (filters.actorRole) params.set('actorRole', filters.actorRole);
      if (filters.sourceKind) params.set('sourceKind', filters.sourceKind);
      const response = await api.get(
        `/statistics/timeseries/${encodeURIComponent(metric)}?${params.toString()}`
      );
      return response.data.points as StatisticsTimeseriesPoint[];
    },
    enabled: options.enabled ?? true,
    refetchOnWindowFocus: false,
  });

export const useStatisticsRanking = (
  metric: string,
  limit = 20,
  options: StatisticsQueryOptions = {}
) =>
  useQuery({
    queryKey: ['statistics', 'ranking', metric, limit],
    queryFn: async () => {
      const response = await api.get(
        `/statistics/rankings/${encodeURIComponent(metric)}?limit=${limit}`
      );
      return response.data.rows as StatisticsRankingRow[];
    },
    enabled: options.enabled ?? true,
    refetchOnWindowFocus: false,
  });
