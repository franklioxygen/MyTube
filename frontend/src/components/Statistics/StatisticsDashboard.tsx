import {
    Alert,
    Box,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Grid,
    Link,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { StatisticsHealth, StatisticsOverview } from '../../hooks/useStatistics';
import { gradient, modeColors } from '../../theme/colors';

export interface StatisticsHealthChip {
    label: string;
    color?: 'default' | 'warning' | 'error';
}

export interface SnapshotCardProps {
    label: string;
    value: string;
}

export interface SeriesCardProps {
    title: string;
    series?: Array<{ day: string; count: number; sum: number }>;
    isLoading: boolean;
    valueLabel: (p: { day: string; count: number; sum: number }) => string;
    emptyText: string;
    secondarySeries?: Array<{ day: string; count: number; sum: number }>;
    secondaryValueLabel?: (count: number) => string;
}

export interface StatisticsSeriesCardConfig extends SeriesCardProps {
    id: string;
}

export interface RankingCardProps {
    title: string;
    rows?: Array<{ key: string; label: string; count: number; sum: number }>;
    isLoading: boolean;
    valueLabel: (r: { key: string; label: string; count: number; sum: number }) => string;
    emptyText: string;
    itemLabel: string;
    valueColumnLabel: string;
    displayMode?: 'table' | 'ranked-list';
    rowHref?: (r: { key: string; label: string; count: number; sum: number }) => string | undefined;
}

export interface StatisticsRankingCardConfig extends RankingCardProps {
    id: string;
    desktopColumns?: 6 | 12;
}

const StatisticsSnapshotGrid: React.FC<{ cards: SnapshotCardProps[] }> = ({ cards }) => (
    <Box
        sx={{
            display: 'grid',
            gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(3, minmax(0, 1fr))',
                md: 'repeat(3, minmax(0, 1fr))',
                lg: 'repeat(5, minmax(0, 1fr))',
            },
            gap: 1.5,
            mb: 3,
        }}
    >
        {cards.map((card) => (
            <SnapshotCard key={card.label} {...card} />
        ))}
    </Box>
);

const SnapshotCard: React.FC<SnapshotCardProps> = ({ label, value }) => {
    const isLongValue = value.length > 18;

    return (
        <Card
            variant="outlined"
            sx={{
                height: '100%',
                borderRadius: 3,
                backgroundImage: (theme) =>
                    theme.palette.mode === 'dark'
                        ? gradient.statsCardDark
                        : gradient.statsCardLight,
            }}
        >
            <CardContent
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 1.25,
                    minHeight: { xs: 96, lg: 88 },
                    p: 2.25,
                    '&:last-child': {
                        pb: 2.25,
                    },
                }}
            >
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        fontWeight: 600,
                        lineHeight: 1.2,
                    }}
                >
                    {label}
                </Typography>
                <Typography
                    variant={isLongValue ? 'h6' : 'h4'}
                    sx={{
                        fontWeight: 700,
                        lineHeight: isLongValue ? 1.2 : 1.05,
                        fontVariantNumeric: 'tabular-nums',
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                    }}
                >
                    {value}
                </Typography>
            </CardContent>
        </Card>
    );
};

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

type StatisticsInsightCard =
    | ({ kind: 'series' } & StatisticsSeriesCardConfig)
    | ({ kind: 'ranking' } & StatisticsRankingCardConfig);

const splitCardsIntoColumns = <T,>(cards: T[]) => ({
    leftCards: cards.filter((_, index) => index % 2 === 0),
    rightCards: cards.filter((_, index) => index % 2 === 1),
});

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
        <Card variant="outlined" sx={{ height: '100%' }}>
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

const RankingCard: React.FC<RankingCardProps> = ({
    title,
    rows,
    isLoading,
    valueLabel,
    emptyText,
    itemLabel,
    valueColumnLabel,
    displayMode = 'table',
    rowHref,
}) => {
    const hasRows = Boolean(rows && rows.length > 0);

    return (
        <Card variant="outlined" sx={{ height: '100%' }}>
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
                {hasRows && rows && displayMode === 'table' && (
                    <Table size="small" sx={{ tableLayout: 'fixed' }}>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ width: '100%' }}>{itemLabel}</TableCell>
                                <TableCell align="right" sx={{ width: 1, whiteSpace: 'nowrap' }}>
                                    {valueColumnLabel}
                                </TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row) => (
                                <TableRow key={row.key}>
                                    <TableCell
                                        sx={{
                                            overflowWrap: 'anywhere',
                                            wordBreak: 'break-word',
                                        }}
                                    >
                                        {row.label}
                                    </TableCell>
                                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                        {valueLabel(row)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
                {hasRows && rows && displayMode === 'ranked-list' && (
                    <Box sx={{ mt: 1 }}>
                        <Stack
                            direction="row"
                            justifyContent="space-between"
                            spacing={2}
                            sx={{
                                px: 2,
                                pb: 1,
                                color: 'text.secondary',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                fontSize: '0.7rem',
                            }}
                        >
                            <Box component="span">{itemLabel}</Box>
                            <Box component="span">{valueColumnLabel}</Box>
                        </Stack>
                        <Stack
                            role="list"
                            aria-label={title}
                            divider={
                                <Box
                                    sx={{
                                        borderBottom: 1,
                                        borderColor: (theme) =>
                                            modeColors(theme.palette.mode).rankingDivider,
                                    }}
                                />
                            }
                        >
                            {rows.map((row, index) => {
                                const href = rowHref?.(row);

                                return (
                                    <Stack
                                        key={row.key}
                                        role="listitem"
                                        direction="row"
                                        spacing={2}
                                        alignItems="flex-start"
                                        sx={{ px: 2, py: 1.5 }}
                                    >
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{
                                                width: 24,
                                                flexShrink: 0,
                                                pt: 0.25,
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            {String(index + 1).padStart(2, '0')}
                                        </Typography>
                                        <Box
                                            sx={{
                                                flex: 1,
                                                minWidth: 0,
                                            }}
                                        >
                                            {href ? (
                                                <Link
                                                    component={RouterLink}
                                                    to={href}
                                                    color="inherit"
                                                    underline="hover"
                                                    variant="body2"
                                                    sx={{
                                                        display: 'block',
                                                        lineHeight: 1.45,
                                                        overflowWrap: 'anywhere',
                                                        wordBreak: 'break-word',
                                                    }}
                                                >
                                                    {row.label}
                                                </Link>
                                            ) : (
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        lineHeight: 1.45,
                                                        overflowWrap: 'anywhere',
                                                        wordBreak: 'break-word',
                                                    }}
                                                >
                                                    {row.label}
                                                </Typography>
                                            )}
                                        </Box>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            sx={{
                                                flexShrink: 0,
                                                pl: 2,
                                                pt: 0.1,
                                                whiteSpace: 'nowrap',
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            {valueLabel(row)}
                                        </Typography>
                                    </Stack>
                                );
                            })}
                        </Stack>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};

const StatisticsInsightsLayout: React.FC<{
    seriesCards: StatisticsSeriesCardConfig[];
    rankingCards: StatisticsRankingCardConfig[];
}> = ({ seriesCards, rankingCards }) => {
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

    const stackedCards: StatisticsInsightCard[] = [
        ...seriesCards.map((card) => ({ ...card, kind: 'series' as const })),
        ...rankingCards
            .filter((card) => card.desktopColumns !== 12)
            .map((card) => ({ ...card, kind: 'ranking' as const })),
    ];
    const fullWidthCards: StatisticsInsightCard[] = rankingCards
        .filter((card) => card.desktopColumns === 12)
        .map((card) => ({ ...card, kind: 'ranking' as const }));

    const renderCard = (card: StatisticsInsightCard) => {
        if (card.kind === 'series') {
            const { kind: _kind, ...seriesCard } = card;
            return <SeriesCard key={seriesCard.id} {...seriesCard} />;
        }

        const { kind: _kind, id, desktopColumns: _desktopColumns, ...rankingCard } = card;
        return <RankingCard key={id} {...rankingCard} />;
    };

    if (!isDesktop) {
        return (
            <Stack spacing={2} sx={{ mt: 2 }}>
                {[...stackedCards, ...fullWidthCards].map(renderCard)}
            </Stack>
        );
    }

    const { leftCards, rightCards } = splitCardsIntoColumns(stackedCards);

    return (
        <Stack spacing={2} sx={{ mt: 2 }}>
            <Grid container spacing={2} alignItems="flex-start">
                <Grid size={{ xs: 12, md: 6 }}>
                    <Stack spacing={2}>{leftCards.map(renderCard)}</Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Stack spacing={2}>{rightCards.map(renderCard)}</Stack>
                </Grid>
            </Grid>
            {fullWidthCards.map(renderCard)}
        </Stack>
    );
};

export const StatisticsDashboardContent: React.FC<{
    overview: StatisticsOverview;
    health?: StatisticsHealth;
    healthChips: StatisticsHealthChip[];
    snapshotCards: SnapshotCardProps[];
    seriesCards: StatisticsSeriesCardConfig[];
    rankingCards: StatisticsRankingCardConfig[];
    healthTitle: string;
}> = ({ overview, health, healthChips, snapshotCards, seriesCards, rankingCards, healthTitle }) => (
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

        <StatisticsSnapshotGrid cards={snapshotCards} />

        <StatisticsHealthCard
            health={health}
            chips={healthChips}
            title={healthTitle}
        />

        <StatisticsInsightsLayout seriesCards={seriesCards} rankingCards={rankingCards} />
    </>
);
