import { ClearAll as ClearAllIcon } from '@mui/icons-material';
import {
    Box,
    Button,
    List,
    Pagination,
    Typography
} from '@mui/material';
import { useMediaQuery, useTheme } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { HistoryItem, DownloadHistoryItem } from './HistoryItem';

interface HistoryTabProps {
    history: DownloadHistoryItem[];
    onRemove: (id: string) => void;
    onClear: () => void;
    onRetry: (sourceUrl: string) => void;
    onReDownload: (sourceUrl: string) => void;
    onViewVideo: (videoId: string) => void;
    isDownloadInProgress: (sourceUrl: string) => boolean;
}

const ITEMS_PER_PAGE = 20;

export function HistoryTab({
    history,
    onRemove,
    onClear,
    onRetry,
    onReDownload,
    onViewVideo,
    isDownloadInProgress
}: HistoryTabProps) {
    const { t } = useLanguage();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [page, setPage] = useState(1);

    return (
        <>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                <Button
                    variant="outlined"
                    startIcon={<ClearAllIcon />}
                    onClick={onClear}
                    disabled={history.length === 0}
                >
                    {t('clearHistory') || 'Clear History'}
                </Button>
            </Box>
            {history.length === 0 ? (
                <Typography color="textSecondary">{t('noDownloadHistory') || 'No download history'}</Typography>
            ) : (
                <>
                    <List>
                        {history
                            .slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
                            .map((item) => (
                                <HistoryItem
                                    key={item.id}
                                    item={item}
                                    onRemove={onRemove}
                                    onRetry={onRetry}
                                    onReDownload={onReDownload}
                                    onViewVideo={onViewVideo}
                                    isDownloadInProgress={isDownloadInProgress}
                                />
                            ))}
                    </List>
                    {history.length > ITEMS_PER_PAGE && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                            <Pagination
                                count={Math.ceil(history.length / ITEMS_PER_PAGE)}
                                page={page}
                                onChange={(_: React.ChangeEvent<unknown>, newPage: number) => setPage(newPage)}
                                color="primary"
                                siblingCount={isMobile ? 0 : 1}
                            />
                        </Box>
                    )}
                </>
            )}
        </>
    );
}

