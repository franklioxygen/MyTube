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
import { useLanguage } from '../../contexts/LanguageContext';
import { DownloadSourceInfo } from './DownloadMediaDetails';

interface Download {
    id: string;
    title: string;
    author?: string;
    sourceCollectionName?: string;
    progress?: number;
    speed?: string;
    downloadedSize?: string;
    totalSize?: string;
}

interface ActiveDownloadsTabProps {
    downloads: Download[];
    onCancel: (id: string) => void;
    cancellingId?: string | null;
}

export function ActiveDownloadsTab({ downloads, onCancel, cancellingId = null }: ActiveDownloadsTabProps) {
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
                            <IconButton
                                edge="end"
                                aria-label="cancel"
                                onClick={() => onCancel(download.id)}
                                loading={cancellingId === download.id}
                            >
                                <CancelIcon />
                            </IconButton>
                        }
                    >
                        <ListItemText
                            primary={download.title}
                            slotProps={{ secondary: { component: 'div' } }}
                            secondary={
                                <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <DownloadSourceInfo author={download.author} sourceCollectionName={download.sourceCollectionName} />
                                    <LinearProgress variant="determinate" value={download.progress || 0} />
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
                                        <Typography variant="caption" color="textSecondary" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                                            •
                                        </Typography>
                                        <Typography variant="caption" color="textSecondary" sx={{ width: { xs: '100%', sm: 'auto' } }}>
                                            {download.downloadedSize || '0'} / {download.totalSize || '?'} ({t('downloadEstimatedSize')})
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
