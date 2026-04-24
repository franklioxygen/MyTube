import { Box, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import RssTokenList from './RssTokenList';

const RssFeedSettings: React.FC = () => {
    const { t } = useLanguage();

    return (
        <Box>
            <Typography variant="h6" gutterBottom>
                {t('rssFeedSettings')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('rssFeedSettingsDescription')}
            </Typography>
            <RssTokenList />
        </Box>
    );
};

export default RssFeedSettings;
