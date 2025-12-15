import { Box, Button, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface DatabaseSettingsProps {
    onMigrate: () => void;
    onDeleteLegacy: () => void;
    onFormatFilenames: () => void;
    isSaving: boolean;
    moveSubtitlesToVideoFolder: boolean;
    onMoveSubtitlesToVideoFolderChange: (checked: boolean) => void;
    moveThumbnailsToVideoFolder: boolean;
    onMoveThumbnailsToVideoFolderChange: (checked: boolean) => void;
}

const DatabaseSettings: React.FC<DatabaseSettingsProps> = ({
    onMigrate,
    onDeleteLegacy,
    onFormatFilenames,
    isSaving,
    moveSubtitlesToVideoFolder,
    onMoveSubtitlesToVideoFolderChange,
    moveThumbnailsToVideoFolder,
    onMoveThumbnailsToVideoFolderChange
}) => {
    const { t } = useLanguage();

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('database')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('migrateDataDescription')}
            </Typography>
            <Button
                variant="outlined"
                color="warning"
                onClick={onMigrate}
                disabled={isSaving}
            >
                {t('migrateDataButton')}
            </Button>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('formatLegacyFilenames')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('formatLegacyFilenamesDescription')}
                </Typography>
                <Button
                    variant="outlined"
                    color="primary"
                    onClick={onFormatFilenames}
                    disabled={isSaving}
                >
                    {t('formatLegacyFilenamesButton')}
                </Button>
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('removeLegacyData')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('removeLegacyDataDescription')}
                </Typography>
                <Button
                    variant="outlined"
                    color="error"
                    onClick={onDeleteLegacy}
                    disabled={isSaving}
                >
                    {t('deleteLegacyDataButton')}
                </Button>
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('moveSubtitlesToVideoFolder')}</Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={moveSubtitlesToVideoFolder}
                            onChange={(e) => onMoveSubtitlesToVideoFolderChange(e.target.checked)}
                            disabled={isSaving}
                        />
                    }
                    label={moveSubtitlesToVideoFolder ? t('moveSubtitlesToVideoFolderOn') : t('moveSubtitlesToVideoFolderOff')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('moveSubtitlesToVideoFolderDescription')}
                </Typography>
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('moveThumbnailsToVideoFolder')}</Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={moveThumbnailsToVideoFolder}
                            onChange={(e) => onMoveThumbnailsToVideoFolderChange(e.target.checked)}
                            disabled={isSaving}
                        />
                    }
                    label={moveThumbnailsToVideoFolder ? t('moveThumbnailsToVideoFolderOn') : t('moveThumbnailsToVideoFolderOff')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('moveThumbnailsToVideoFolderDescription')}
                </Typography>
            </Box>
        </Box>
    );
};

export default DatabaseSettings;
