import { Box, Button, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface DatabaseSettingsProps {
    onMigrate: () => void;
    onDeleteLegacy: () => void;
    onFormatFilenames: () => void;
    isSaving: boolean;
}

const DatabaseSettings: React.FC<DatabaseSettingsProps> = ({ onMigrate, onDeleteLegacy, onFormatFilenames, isSaving }) => {
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
        </Box>
    );
};

export default DatabaseSettings;
