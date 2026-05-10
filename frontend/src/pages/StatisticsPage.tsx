import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Container,
    Grid,
    MenuItem,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSettings } from '../hooks/useSettings';
import {
    StatisticsHealth,
    StatisticsOverview,
    StatisticsRankingRow,
    StatisticsTimeseriesPoint,
    useStatisticsHealth,
    useStatisticsOverview,
    useStatisticsRanking,
    useStatisticsTimeseries,
} from '../hooks/useStatistics';
import { api } from '../utils/apiClient';

const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i += 1;
    }
    return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
};

const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

const formatDiskRunway = (runway?: {
    status?: string;
    daysRemaining?: number;
}): string => {
    if (!runway) return '—';
    if (runway.status === 'ok' && typeof runway.daysRemaining === 'number') {
        return `${Math.max(0, Math.floor(runway.daysRemaining))} days`;
    }
    if (runway.status === 'unavailable_storage') {
        return 'Unavailable for this storage mode';
    }
    return 'Not enough recent activity';
};

type TranslateFn = (key: string, params?: Record<string, unknown>) => string | undefined;

const RANGE_OPTIONS = [
    { value: 7, labelKey: 'last7Days', fallback: 'Last 7 days' },
    { value: 30, labelKey: 'last30Days', fallback: 'Last 30 days' },
    { value: 90, labelKey: 'last90Days', fallback: 'Last 90 days' },
    { value: 365, labelKey: 'last365Days', fallback: 'Last 365 days' },
] as const;

interface StatisticsHealthChip {
    label: string;
    color?: 'default' | 'warning' | 'error';
}

interface StatisticsSeriesCardConfig extends SeriesCardProps {
    id: string;
}

interface StatisticsRankingCardConfig extends RankingCardProps {
    id: string;
}

const translateOrFallback = (
    t: TranslateFn,
    key: string,
    fallback: string,
    params?: Record<string, unknown>
): string => t(key, params) || fallback;

const buildSnapshotCards = (overview: StatisticsOverview, t: TranslateFn): SnapshotCardProps[] => [
    {
        label: translateOrFallback(t, 'totalVideos', 'Total videos'),
        value: overview.totalVideos.toLocaleString(),
    },
    {
        label: translateOrFallback(t, 'totalStorage', 'Total storage'),
        value: formatBytes(overview.totalStorageBytes),
    },
    {
        label: translateOrFallback(t, 'downloadSuccessRate', 'Download success rate'),
        value:
            overview.downloadSuccessRate === null
                ? '—'
                : `${(overview.downloadSuccessRate * 100).toFixed(1)}%`,
    },
    {
        label: translateOrFallback(t, 'netNewVideos', 'Net new videos'),
        value: overview.netNewVideos.toLocaleString(),
    },
    {
        label: translateOrFallback(t, 'downloadVolume', 'Download volume'),
        value: formatBytes(overview.downloadVolumeBytes),
    },
    {
        label: translateOrFallback(t, 'watchTime', 'Watch time'),
        value: formatDuration(overview.watchSecondsLastRange),
    },
    {
        label: translateOrFallback(t, 'diskRunway', 'Disk runway'),
        value: formatDiskRunway(overview.diskRunway),
    },
    {
        label: translateOrFallback(t, 'activeSubscriptions', 'Active subscriptions'),
        value: overview.activeSubscriptions.toLocaleString(),
    },
    {
        label: translateOrFallback(t, 'activeRssTokens', 'Active RSS tokens'),
        value: overview.activeRssTokens.toLocaleString(),
    },
];

const buildHealthChips = (health: StatisticsHealth, t: TranslateFn): StatisticsHealthChip[] => {
    const lastRunLabel = health.rollup.lastRunAt
        ? translateOrFallback(t, 'statisticsLastRunAt', 'Last run {date}', {
              date: new Date(health.rollup.lastRunAt).toLocaleString(),
          })
        : translateOrFallback(t, 'statisticsWorkerNotRunYet', 'Worker has not run yet');

    return [
        {
            label: lastRunLabel,
            color: health.warning ? 'warning' : 'default',
        },
        {
            label: translateOrFallback(t, 'statisticsDirtyDays', `Dirty days: ${health.dirtyDayCount}`, {
                count: health.dirtyDayCount,
            }),
        },
        {
            label: translateOrFallback(
                t,
                'statisticsSealedDays',
                `Sealed days: ${health.sealedDayCount}`,
                { count: health.sealedDayCount }
            ),
        },
        {
            label: translateOrFallback(
                t,
                'statisticsLastHourAccepted',
                `Last hour accepted: ${health.trailingHour.accepted}`,
                { count: health.trailingHour.accepted }
            ),
        },
        {
            label: translateOrFallback(
                t,
                'statisticsDropped',
                `Dropped: ${health.trailingHour.dropped}`,
                { count: health.trailingHour.dropped }
            ),
            color: health.trailingHour.dropped > 0 ? 'warning' : 'default',
        },
        {
            label: translateOrFallback(
                t,
                'statisticsErrors',
                `Errors: ${health.trailingHour.error}`,
                { count: health.trailingHour.error }
            ),
            color: health.trailingHour.error > 0 ? 'error' : 'default',
        },
        {
            label: translateOrFallback(
                t,
                'statisticsSealedDayDrops',
                `Sealed-day drops: ${health.trailingHour.sealedDayDrop}`,
                { count: health.trailingHour.sealedDayDrop }
            ),
            color: health.trailingHour.sealedDayDrop > 0 ? 'warning' : 'default',
        },
    ];
};

const buildSeriesCardConfigs = (params: {
    t: TranslateFn;
    watchSeries?: StatisticsTimeseriesPoint[];
    watchSeriesLoading: boolean;
    completedSeries?: StatisticsTimeseriesPoint[];
    completedSeriesLoading: boolean;
    failedSeries?: StatisticsTimeseriesPoint[];
    librarySeries?: StatisticsTimeseriesPoint[];
    librarySeriesLoading: boolean;
}): StatisticsSeriesCardConfig[] => {
    const emptyText = translateOrFallback(
        params.t,
        'statisticsNotEnoughHistoricalDataYet',
        'Not enough historical data yet'
    );

    return [
        {
            id: 'watch-time',
            title: translateOrFallback(params.t, 'watchTimeByDay', 'Watch time by day'),
            series: params.watchSeries,
            isLoading: params.watchSeriesLoading,
            valueLabel: (point) => formatDuration(point.sum),
            emptyText,
        },
        {
            id: 'completed-vs-failed',
            title: translateOrFallback(
                params.t,
                'completedVsFailedByDay',
                'Completed vs failed downloads'
            ),
            series: params.completedSeries,
            isLoading: params.completedSeriesLoading,
            valueLabel: (point) =>
                translateOrFallback(params.t, 'statisticsCompletedCount', `${point.count} completed`, {
                    count: point.count,
                }),
            emptyText,
            secondarySeries: params.failedSeries,
            secondaryValueLabel: (count) =>
                translateOrFallback(params.t, 'statisticsFailedCount', `${count} failed`, {
                    count,
                }),
        },
        {
            id: 'library-additions',
            title: translateOrFallback(params.t, 'libraryAdditionsByDay', 'Library additions by day'),
            series: params.librarySeries,
            isLoading: params.librarySeriesLoading,
            valueLabel: (point) => `${point.count}`,
            emptyText,
        },
    ];
};

const buildRankingCardConfigs = (params: {
    t: TranslateFn;
    topWatched?: StatisticsRankingRow[];
    topWatchedLoading: boolean;
    productiveSubs?: StatisticsRankingRow[];
    productiveSubsLoading: boolean;
    accessedFeeds?: StatisticsRankingRow[];
    accessedFeedsLoading: boolean;
    failureBuckets?: StatisticsRankingRow[];
    failureBucketsLoading: boolean;
    largestUnwatched?: StatisticsRankingRow[];
    largestUnwatchedLoading: boolean;
}): StatisticsRankingCardConfig[] => {
    const emptyText = translateOrFallback(params.t, 'statisticsNoData', 'No data');
    const itemLabel = translateOrFallback(params.t, 'statisticsItem', 'Item');
    const valueColumnLabel = translateOrFallback(params.t, 'statisticsValue', 'Value');

    return [
        {
            id: 'top-watched',
            title: translateOrFallback(params.t, 'topWatchedVideos', 'Top watched videos'),
            rows: params.topWatched,
            isLoading: params.topWatchedLoading,
            valueLabel: (row) => formatDuration(row.sum),
            emptyText,
            itemLabel,
            valueColumnLabel,
        },
        {
            id: 'productive-subs',
            title: translateOrFallback(
                params.t,
                'mostProductiveSubscriptions',
                'Most productive subscriptions'
            ),
            rows: params.productiveSubs,
            isLoading: params.productiveSubsLoading,
            valueLabel: (row) => `${row.count}`,
            emptyText,
            itemLabel,
            valueColumnLabel,
        },
        {
            id: 'accessed-feeds',
            title: translateOrFallback(params.t, 'mostAccessedRssFeeds', 'Most accessed RSS feeds'),
            rows: params.accessedFeeds,
            isLoading: params.accessedFeedsLoading,
            valueLabel: (row) => `${row.count}`,
            emptyText,
            itemLabel,
            valueColumnLabel,
        },
        {
            id: 'failure-buckets',
            title: translateOrFallback(params.t, 'mostCommonFailures', 'Most common failure buckets'),
            rows: params.failureBuckets,
            isLoading: params.failureBucketsLoading,
            valueLabel: (row) => `${row.count}`,
            emptyText,
            itemLabel,
            valueColumnLabel,
        },
        {
            id: 'largest-unwatched',
            title: translateOrFallback(params.t, 'largestNeverWatched', 'Largest never-watched items'),
            rows: params.largestUnwatched,
            isLoading: params.largestUnwatchedLoading,
            valueLabel: (row) => formatBytes(row.sum),
            emptyText,
            itemLabel,
            valueColumnLabel,
        },
    ];
};

const StatisticsToolbar: React.FC<{
    rangeDays: number;
    setRangeDays: (value: number) => void;
    onExport: (format: 'csv' | 'json') => Promise<void>;
    onRecompute: () => Promise<void>;
    onClear: () => Promise<void>;
    t: TranslateFn;
}> = ({ rangeDays, setRangeDays, onExport, onRecompute, onClear, t }) => (
    <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
    >
        <Typography variant="h4" component="h1" fontWeight="bold">
            {translateOrFallback(t, 'statisticsTitle', 'Statistics')}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap">
            <Select
                size="small"
                value={rangeDays}
                onChange={(event) => setRangeDays(Number(event.target.value))}
            >
                {RANGE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                        {translateOrFallback(t, option.labelKey, option.fallback)}
                    </MenuItem>
                ))}
            </Select>
            <Button variant="outlined" onClick={() => void onExport('csv')}>
                {translateOrFallback(t, 'exportCsv', 'Export CSV')}
            </Button>
            <Button variant="outlined" onClick={() => void onExport('json')}>
                {translateOrFallback(t, 'exportJson', 'Export JSON')}
            </Button>
            <Button variant="outlined" onClick={() => void onRecompute()}>
                {translateOrFallback(t, 'recomputeStatistics', 'Recompute')}
            </Button>
            <Button variant="outlined" color="error" onClick={() => void onClear()}>
                {translateOrFallback(t, 'statisticsClear', 'Clear')}
            </Button>
        </Stack>
    </Stack>
);

const StatisticsHealthCard: React.FC<{
    health?: StatisticsHealth;
    chips: StatisticsHealthChip[];
    title: string;
}> = ({ health, chips, title }) => (
    <Card sx={{ mb: 3 }}>
        <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>
                {title}
            </Typography>
            {!health ? (
                <CircularProgress size={20} />
            ) : (
                <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
                    {chips.map((chip) => (
                        <Chip key={chip.label} label={chip.label} color={chip.color ?? 'default'} />
                    ))}
                </Stack>
            )}
        </CardContent>
    </Card>
);

const StatisticsSeriesGrid: React.FC<{ cards: StatisticsSeriesCardConfig[] }> = ({ cards }) => (
    <Grid container spacing={2}>
        {cards.map((card) => (
            <Grid key={card.id} size={{ xs: 12, md: 6 }}>
                <SeriesCard {...card} />
            </Grid>
        ))}
    </Grid>
);

const StatisticsRankingsGrid: React.FC<{ cards: StatisticsRankingCardConfig[] }> = ({ cards }) => (
    <Grid container spacing={2} sx={{ mt: 3 }}>
        {cards.map((card) => (
            <Grid key={card.id} size={{ xs: 12, md: 6 }}>
                <RankingCard {...card} />
            </Grid>
        ))}
    </Grid>
);

const StatisticsDashboardContent: React.FC<{
    overview: StatisticsOverview;
    health?: StatisticsHealth;
    healthChips: StatisticsHealthChip[];
    snapshotCards: SnapshotCardProps[];
    seriesCards: StatisticsSeriesCardConfig[];
    rankingCards: StatisticsRankingCardConfig[];
    t: TranslateFn;
}> = ({ overview, health, healthChips, snapshotCards, seriesCards, rankingCards, t }) => (
    <>
        {overview.alerts.length > 0 && (
            <Stack spacing={1} sx={{ mb: 3 }}>
                {overview.alerts.map((alert) => (
                    <Alert
                        key={alert.key}
                        severity={alert.severity === 'critical' ? 'error' : 'warning'}
                    >
                        {alert.title}
                    </Alert>
                ))}
            </Stack>
        )}

        <Grid container spacing={2} sx={{ mb: 3 }}>
            {snapshotCards.map((card) => (
                <SnapshotCard key={card.label} {...card} />
            ))}
        </Grid>

        <StatisticsHealthCard
            health={health}
            chips={healthChips}
            title={translateOrFallback(t, 'statisticsHealth', 'Statistics health')}
        />

        <StatisticsSeriesGrid cards={seriesCards} />
        <StatisticsRankingsGrid cards={rankingCards} />
    </>
);

const StatisticsPage: React.FC = () => {
    const { t } = useLanguage();
    const { userRole, loginRequired } = useAuth();
    const { data: settings } = useSettings();
    const [rangeDays, setRangeDays] = useState(30);
    const queryClient = useQueryClient();

    const isAdmin = !loginRequired || userRole === 'admin';
    const enabled = settings?.statisticsEnabled === true;

    const overviewQuery = useStatisticsOverview(rangeDays, { enabled: isAdmin });
    const healthQuery = useStatisticsHealth({ enabled: isAdmin });
    const watchSeries = useStatisticsTimeseries('watch_seconds', rangeDays, {}, { enabled: isAdmin });
    const completedSeries = useStatisticsTimeseries(
        'downloads_completed_by_day',
        rangeDays,
        {},
        { enabled: isAdmin }
    );
    const failedSeries = useStatisticsTimeseries(
        'downloads_failed_by_day',
        rangeDays,
        {},
        { enabled: isAdmin }
    );
    const librarySeries = useStatisticsTimeseries(
        'library_added_by_day',
        rangeDays,
        {},
        { enabled: isAdmin }
    );
    const topWatched = useStatisticsRanking('top_watched_videos', 10, { enabled: isAdmin });
    const productiveSubs = useStatisticsRanking('most_productive_subscriptions', 10, { enabled: isAdmin });
    const accessedFeeds = useStatisticsRanking('most_accessed_rss_feeds', 10, { enabled: isAdmin });
    const failureBuckets = useStatisticsRanking('most_common_failure_buckets', 10, { enabled: isAdmin });
    const largestUnwatched = useStatisticsRanking('largest_never_watched', 10, { enabled: isAdmin });

    if (!isAdmin) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Alert severity="warning">
                    {t('statisticsAdminOnly') || 'Statistics is admin-only.'}
                </Alert>
            </Container>
        );
    }

    const overview = overviewQuery.data;
    const health = healthQuery.data;
    const snapshotCards = overview ? buildSnapshotCards(overview, t) : [];
    const healthChips = health ? buildHealthChips(health, t) : [];
    const seriesCards = buildSeriesCardConfigs({
        t,
        watchSeries: watchSeries.data,
        watchSeriesLoading: watchSeries.isLoading,
        completedSeries: completedSeries.data,
        completedSeriesLoading: completedSeries.isLoading,
        failedSeries: failedSeries.data,
        librarySeries: librarySeries.data,
        librarySeriesLoading: librarySeries.isLoading,
    });
    const rankingCards = buildRankingCardConfigs({
        t,
        topWatched: topWatched.data,
        topWatchedLoading: topWatched.isLoading,
        productiveSubs: productiveSubs.data,
        productiveSubsLoading: productiveSubs.isLoading,
        accessedFeeds: accessedFeeds.data,
        accessedFeedsLoading: accessedFeeds.isLoading,
        failureBuckets: failureBuckets.data,
        failureBucketsLoading: failureBuckets.isLoading,
        largestUnwatched: largestUnwatched.data,
        largestUnwatchedLoading: largestUnwatched.isLoading,
    });

    const refreshStatisticsQueries = async () => {
        await queryClient.invalidateQueries({ queryKey: ['statistics'] });
    };

    const handleExport = async (format: 'csv' | 'json') => {
        const params = new URLSearchParams({
            format,
            view: 'dashboard',
            range: String(rangeDays)
        });
        const response = await api.get(`/statistics/export?${params.toString()}`, {
            responseType: 'blob',
        });
        const blob = new Blob([response.data]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mytube-statistics.${format}`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleClear = async () => {
        if (!confirm(t('statisticsClearConfirm') || 'Clear all collected statistics data?')) return;
        await api.delete('/statistics');
        await refreshStatisticsQueries();
    };

    const handleRecompute = async () => {
        await api.post('/statistics/recompute', {});
        await refreshStatisticsQueries();
    };

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <StatisticsToolbar
                rangeDays={rangeDays}
                setRangeDays={setRangeDays}
                onExport={handleExport}
                onRecompute={handleRecompute}
                onClear={handleClear}
                t={t}
            />

            {!enabled && (
                <Alert severity="info" sx={{ mb: 3 }}>
                    {translateOrFallback(
                        t,
                        'statisticsDisabledKeepVisibleNotice',
                        'Statistics collection is disabled. Existing reports remain available until you clear them.'
                    )}
                </Alert>
            )}

            {overviewQuery.isLoading && <CircularProgress />}

            {overview && (
                <StatisticsDashboardContent
                    overview={overview}
                    health={health}
                    healthChips={healthChips}
                    snapshotCards={snapshotCards}
                    seriesCards={seriesCards}
                    rankingCards={rankingCards}
                    t={t}
                />
            )}
        </Container>
    );
};

interface SnapshotCardProps {
    label: string;
    value: string;
}

const SnapshotCard: React.FC<SnapshotCardProps> = ({ label, value }) => (
    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
                <Typography variant="caption" color="text.secondary">
                    {label}
                </Typography>
                <Typography variant="h6">{value}</Typography>
            </CardContent>
        </Card>
    </Grid>
);

interface SeriesCardProps {
    title: string;
    series?: Array<{ day: string; count: number; sum: number }>;
    isLoading: boolean;
    valueLabel: (p: { day: string; count: number; sum: number }) => string;
    emptyText: string;
    secondarySeries?: Array<{ day: string; count: number; sum: number }>;
    secondaryValueLabel?: (count: number) => string;
}

const SeriesCard: React.FC<SeriesCardProps> = ({
    title,
    series,
    isLoading,
    valueLabel,
    emptyText,
    secondarySeries,
    secondaryValueLabel,
}) => {
    const hasSeries = Boolean(series && series.length > 0);
    const secondaryCounts = new Map(
        (secondarySeries ?? []).map((point) => [point.day, point.count] as const)
    );

    return (
        <Card variant="outlined">
            <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                    {title}
                </Typography>
                {isLoading && <CircularProgress size={20} />}
                {!isLoading && !hasSeries && (
                    <Typography variant="body2" color="text.secondary">
                        {emptyText}
                    </Typography>
                )}
                {hasSeries && series && (
                    <Box
                        sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 1,
                            maxHeight: 220,
                            overflow: 'auto',
                        }}
                    >
                        {series.map((p) => (
                            <Box
                                key={p.day}
                                sx={{
                                    px: 1,
                                    py: 0.5,
                                    border: 1,
                                    borderColor: 'divider',
                                    borderRadius: 1,
                                    minWidth: 130,
                                }}
                            >
                                <Typography variant="caption" color="text.secondary">
                                    {p.day}
                                </Typography>
                                <Typography variant="body2">{valueLabel(p)}</Typography>
                                {secondarySeries && secondaryValueLabel && (
                                    <Typography variant="caption" color="text.secondary">
                                        {secondaryValueLabel(secondaryCounts.get(p.day) ?? 0)}
                                    </Typography>
                                )}
                            </Box>
                        ))}
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};

interface RankingCardProps {
    title: string;
    rows?: Array<{ key: string; label: string; count: number; sum: number }>;
    isLoading: boolean;
    valueLabel: (r: { key: string; label: string; count: number; sum: number }) => string;
    emptyText: string;
    itemLabel: string;
    valueColumnLabel: string;
}

const RankingCard: React.FC<RankingCardProps> = ({
    title,
    rows,
    isLoading,
    valueLabel,
    emptyText,
    itemLabel,
    valueColumnLabel,
}) => {
    const hasRows = Boolean(rows && rows.length > 0);

    return (
        <Card variant="outlined">
            <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                    {title}
                </Typography>
                {isLoading && <CircularProgress size={20} />}
                {!isLoading && !hasRows && (
                    <Typography variant="body2" color="text.secondary">
                        {emptyText}
                    </Typography>
                )}
                {hasRows && rows && (
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>{itemLabel}</TableCell>
                                <TableCell align="right">{valueColumnLabel}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row) => (
                                <TableRow key={row.key}>
                                    <TableCell>{row.label}</TableCell>
                                    <TableCell align="right">{valueLabel(row)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
};

export default StatisticsPage;
