import { Cancel as CancelIcon } from '@mui/icons-material';
import {
    Box,
    IconButton,
    LinearProgress,
    List,
    ListItem,
    ListItemText,
    Paper,
    Typography
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface Download {
    id: string;
    title: string;
    progress?: number;
    speed?: string;
    downloadedSize?: string;
    totalSize?: string;
}

interface ActiveDownloadsTabProps {
    downloads: Download[];
    onCancel: (id: string) => void;
}

export function ActiveDownloadsTab({ downloads, onCancel }: ActiveDownloadsTabProps) {
    const { t } = useLanguage();

    if (downloads.length === 0) {
        return <Typography color="textSecondary">{t('noActiveDownloads') || 'No active downloads'}</Typography>;
    }

    return (
        <List>
            {downloads.map((download) => (
                <Paper key={download.id} sx={{ mb: 2, p: 2 }}>
                    <ListItem
                        disableGutters
                        secondaryAction={
                            <IconButton edge="end" aria-label="cancel" onClick={() => onCancel(download.id)}>
                                <CancelIcon />
                            </IconButton>
                        }
                    >
                        <ListItemText
                            primary={download.title}
                            slotProps={{ secondary: { component: 'div' } }}
                            secondary={
                                <Box sx={{ mt: 1 }}>
                                    <LinearProgress variant="determinate" value={download.progress || 0} sx={{ mb: 1 }} />
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                        <Typography variant="body2" fontWeight="bold" color="primary">
                                            {download.progress?.toFixed(1)}%
                                        </Typography>
                                        <Typography variant="caption" color="textSecondary">
                                            •
                                        </Typography>
                                        <Typography variant="caption" color="textSecondary">
                                            {download.speed || '0 B/s'}
                                        </Typography>
                                        <Typography variant="caption" color="textSecondary">
                                            •
                                        </Typography>
                                        <Typography variant="caption" color="textSecondary">
                                            {download.downloadedSize || '0'} / {download.totalSize || '?'}
                                        </Typography>
                                    </Box>
                                </Box>
                            }
                        />
                    </ListItem>
                </Paper>
            ))}
        </List>
    );
}

