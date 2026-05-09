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
            <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                spacing={2}
                sx={{ mb: 3 }}
            >
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('statisticsTitle') || 'Statistics'}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Select
                        size="small"
                        value={rangeDays}
                        onChange={(e) => setRangeDays(Number(e.target.value))}
                    >
                        <MenuItem value={7}>{t('last7Days') || 'Last 7 days'}</MenuItem>
                        <MenuItem value={30}>{t('last30Days') || 'Last 30 days'}</MenuItem>
                        <MenuItem value={90}>{t('last90Days') || 'Last 90 days'}</MenuItem>
                        <MenuItem value={365}>{t('last365Days') || 'Last 365 days'}</MenuItem>
                    </Select>
                    <Button variant="outlined" onClick={() => handleExport('csv')}>
                        {t('exportCsv') || 'Export CSV'}
                    </Button>
                    <Button variant="outlined" onClick={() => handleExport('json')}>
                        {t('exportJson') || 'Export JSON'}
                    </Button>
                    <Button variant="outlined" onClick={handleRecompute}>
                        {t('recomputeStatistics') || 'Recompute'}
                    </Button>
                    <Button variant="outlined" color="error" onClick={handleClear}>
                        {t('statisticsClear') || 'Clear'}
                    </Button>
                </Stack>
            </Stack>

            {!enabled && (
                <Alert severity="info" sx={{ mb: 3 }}>
                    {t('statisticsDisabledKeepVisibleNotice') ||
                        'Statistics collection is disabled. Existing reports remain available until you clear them.'}
                </Alert>
            )}

            {overviewQuery.isLoading && <CircularProgress />}

            {overview && (
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
                        <SnapshotCard
                            label={t('totalVideos') || 'Total videos'}
                            value={overview.totalVideos.toLocaleString()}
                        />
                        <SnapshotCard
                            label={t('totalStorage') || 'Total storage'}
                            value={formatBytes(overview.totalStorageBytes)}
                        />
                        <SnapshotCard
                            label={t('downloadSuccessRate') || 'Download success rate'}
                            value={
                                overview.downloadSuccessRate === null
                                    ? '—'
                                    : `${(overview.downloadSuccessRate * 100).toFixed(1)}%`
                            }
                        />
                        <SnapshotCard
                            label={t('netNewVideos') || 'Net new videos'}
                            value={overview.netNewVideos.toLocaleString()}
                        />
                        <SnapshotCard
                            label={t('downloadVolume') || 'Download volume'}
                            value={formatBytes(overview.downloadVolumeBytes)}
                        />
                        <SnapshotCard
                            label={t('watchTime') || 'Watch time'}
                            value={formatDuration(overview.watchSecondsLastRange)}
                        />
                        <SnapshotCard
                            label={t('diskRunway') || 'Disk runway'}
                            value={formatDiskRunway(overview.diskRunway)}
                        />
                        <SnapshotCard
                            label={t('activeSubscriptions') || 'Active subscriptions'}
                            value={overview.activeSubscriptions.toLocaleString()}
                        />
                        <SnapshotCard
                            label={t('activeRssTokens') || 'Active RSS tokens'}
                            value={overview.activeRssTokens.toLocaleString()}
                        />
                    </Grid>

                    <Card sx={{ mb: 3 }}>
                        <CardContent>
                            <Typography variant="h6" sx={{ mb: 1 }}>
                                {t('statisticsHealth') || 'Statistics health'}
                            </Typography>
                            {!health ? (
                                <CircularProgress size={20} />
                            ) : (
                                <Stack
                                    direction="row"
                                    spacing={2}
                                    flexWrap="wrap"
                                    alignItems="center"
                                >
                                    <Chip
                                        label={
                                            health.rollup.lastRunAt
                                                ? t('statisticsLastRunAt', {
                                                      date: new Date(
                                                          health.rollup.lastRunAt
                                                      ).toLocaleString(),
                                                  }) || 'Last run {date}'
                                                : t('statisticsWorkerNotRunYet') ||
                                                  'Worker has not run yet'
                                        }
                                        color={health.warning ? 'warning' : 'default'}
                                    />
                                    <Chip
                                        label={
                                            t('statisticsDirtyDays', {
                                                count: health.dirtyDayCount,
                                            }) || `Dirty days: ${health.dirtyDayCount}`
                                        }
                                    />
                                    <Chip
                                        label={
                                            t('statisticsSealedDays', {
                                                count: health.sealedDayCount,
                                            }) || `Sealed days: ${health.sealedDayCount}`
                                        }
                                    />
                                    <Chip
                                        label={
                                            t('statisticsLastHourAccepted', {
                                                count: health.trailingHour.accepted,
                                            }) ||
                                            `Last hour accepted: ${health.trailingHour.accepted}`
                                        }
                                    />
                                    <Chip
                                        label={
                                            t('statisticsDropped', {
                                                count: health.trailingHour.dropped,
                                            }) || `Dropped: ${health.trailingHour.dropped}`
                                        }
                                        color={
                                            health.trailingHour.dropped > 0 ? 'warning' : 'default'
                                        }
                                    />
                                    <Chip
                                        label={
                                            t('statisticsErrors', {
                                                count: health.trailingHour.error,
                                            }) || `Errors: ${health.trailingHour.error}`
                                        }
                                        color={
                                            health.trailingHour.error > 0 ? 'error' : 'default'
                                        }
                                    />
                                    <Chip
                                        label={
                                            t('statisticsSealedDayDrops', {
                                                count: health.trailingHour.sealedDayDrop,
                                            }) ||
                                            `Sealed-day drops: ${health.trailingHour.sealedDayDrop}`
                                        }
                                        color={
                                            health.trailingHour.sealedDayDrop > 0
                                                ? 'warning'
                                                : 'default'
                                        }
                                    />
                                </Stack>
                            )}
                        </CardContent>
                    </Card>

                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <SeriesCard
                                title={t('watchTimeByDay') || 'Watch time by day'}
                                series={watchSeries.data}
                                isLoading={watchSeries.isLoading}
                                valueLabel={(p) => formatDuration(p.sum)}
                                emptyText={
                                    t('statisticsNotEnoughHistoricalDataYet') ||
                                    'Not enough historical data yet'
                                }
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <SeriesCard
                                title={
                                    t('completedVsFailedByDay') || 'Completed vs failed downloads'
                                }
                                series={completedSeries.data}
                                isLoading={completedSeries.isLoading}
                                valueLabel={(p) =>
                                    t('statisticsCompletedCount', { count: p.count }) ||
                                    `${p.count} completed`
                                }
                                secondarySeries={failedSeries.data}
                                secondaryValueLabel={(count) =>
                                    t('statisticsFailedCount', { count }) || `${count} failed`
                                }
                                emptyText={
                                    t('statisticsNotEnoughHistoricalDataYet') ||
                                    'Not enough historical data yet'
                                }
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <SeriesCard
                                title={t('libraryAdditionsByDay') || 'Library additions by day'}
                                series={librarySeries.data}
                                isLoading={librarySeries.isLoading}
                                valueLabel={(p) => `${p.count}`}
                                emptyText={
                                    t('statisticsNotEnoughHistoricalDataYet') ||
                                    'Not enough historical data yet'
                                }
                            />
                        </Grid>
                    </Grid>

                    <Grid container spacing={2} sx={{ mt: 3 }}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <RankingCard
                                title={t('topWatchedVideos') || 'Top watched videos'}
                                rows={topWatched.data}
                                isLoading={topWatched.isLoading}
                                valueLabel={(r) => formatDuration(r.sum)}
                                emptyText={t('statisticsNoData') || 'No data'}
                                itemLabel={t('statisticsItem') || 'Item'}
                                valueColumnLabel={t('statisticsValue') || 'Value'}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <RankingCard
                                title={t('mostProductiveSubscriptions') || 'Most productive subscriptions'}
                                rows={productiveSubs.data}
                                isLoading={productiveSubs.isLoading}
                                valueLabel={(r) => `${r.count}`}
                                emptyText={t('statisticsNoData') || 'No data'}
                                itemLabel={t('statisticsItem') || 'Item'}
                                valueColumnLabel={t('statisticsValue') || 'Value'}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <RankingCard
                                title={t('mostAccessedRssFeeds') || 'Most accessed RSS feeds'}
                                rows={accessedFeeds.data}
                                isLoading={accessedFeeds.isLoading}
                                valueLabel={(r) => `${r.count}`}
                                emptyText={t('statisticsNoData') || 'No data'}
                                itemLabel={t('statisticsItem') || 'Item'}
                                valueColumnLabel={t('statisticsValue') || 'Value'}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <RankingCard
                                title={t('mostCommonFailures') || 'Most common failure buckets'}
                                rows={failureBuckets.data}
                                isLoading={failureBuckets.isLoading}
                                valueLabel={(r) => `${r.count}`}
                                emptyText={t('statisticsNoData') || 'No data'}
                                itemLabel={t('statisticsItem') || 'Item'}
                                valueColumnLabel={t('statisticsValue') || 'Value'}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <RankingCard
                                title={t('largestNeverWatched') || 'Largest never-watched items'}
                                rows={largestUnwatched.data}
                                isLoading={largestUnwatched.isLoading}
                                valueLabel={(r) => formatBytes(r.sum)}
                                emptyText={t('statisticsNoData') || 'No data'}
                                itemLabel={t('statisticsItem') || 'Item'}
                                valueColumnLabel={t('statisticsValue') || 'Value'}
                            />
                        </Grid>
                    </Grid>
                </>
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
    return (
        <Card variant="outlined">
            <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                    {title}
                </Typography>
                {isLoading && <CircularProgress size={20} />}
                {!isLoading && (!series || series.length === 0) && (
                    <Typography variant="body2" color="text.secondary">
                        {emptyText}
                    </Typography>
                )}
                {series && series.length > 0 && (
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
                                        {secondaryValueLabel(
                                            secondarySeries.find((q) => q.day === p.day)?.count ?? 0
                                        )}
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
    return (
        <Card variant="outlined">
            <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                    {title}
                </Typography>
                {isLoading && <CircularProgress size={20} />}
                {!isLoading && (!rows || rows.length === 0) && (
                    <Typography variant="body2" color="text.secondary">
                        {emptyText}
                    </Typography>
                )}
                {rows && rows.length > 0 && (
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
