import { ClearAll as ClearAllIcon, Delete as DeleteIcon } from '@mui/icons-material';
import {
    Box,
    Button,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Pagination,
    Paper,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useMediaQuery, useTheme } from '@mui/material';

interface Download {
    id: string;
    title: string;
}

interface QueueTabProps {
    downloads: Download[];
    onRemove: (id: string) => void;
    onClear: () => void;
}

const ITEMS_PER_PAGE = 20;

export function QueueTab({ downloads, onRemove, onClear }: QueueTabProps) {
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
                    disabled={downloads.length === 0}
                >
                    {t('clearQueue') || 'Clear Queue'}
                </Button>
            </Box>
            {downloads.length === 0 ? (
                <Typography color="textSecondary">{t('noQueuedDownloads') || 'No queued downloads'}</Typography>
            ) : (
                <>
                    <List>
                        {downloads
                            .slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
                            .map((download) => (
                                <Paper key={download.id} sx={{ mb: 2, p: 2 }}>
                                    <ListItem
                                        disableGutters
                                        secondaryAction={
                                            <IconButton edge="end" aria-label="remove" onClick={() => onRemove(download.id)}>
                                                <DeleteIcon />
                                            </IconButton>
                                        }
                                    >
                                        <ListItemText
                                            primary={download.title}
                                            secondary={t('queued') || 'Queued'}
                                        />
                                    </ListItem>
                                </Paper>
                            ))}
                    </List>
                    {downloads.length > ITEMS_PER_PAGE && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                            <Pagination
                                count={Math.ceil(downloads.length / ITEMS_PER_PAGE)}
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

