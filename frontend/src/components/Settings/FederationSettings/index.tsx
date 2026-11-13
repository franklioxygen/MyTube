import { Box, Divider, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import FederationPeers from './FederationPeers';
import FederationTokens from './FederationTokens';

/** Multi-instance library (issue #354): owner-only settings. */
const FederationSettings: React.FC = () => {
    const { t } = useLanguage();

    return (
        <Box>
            <Typography variant="h6" gutterBottom>
                {t('federationTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('federationDescription')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <FederationTokens />
                <Divider />
                <FederationPeers />
            </Box>
        </Box>
    );
};

export default FederationSettings;
