import { Alert, Box } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { Video } from '../../../types';
import { remoteInstanceName } from '../../../utils/libraryItem';
import RemoteOriginChip from '../../RemoteOriginChip';

/** Where a remote item comes from, and why it cannot play while its peer is down. */
const RemoteOriginNotice: React.FC<{ video: Video }> = ({ video }) => {
    const { t } = useLanguage();
    return (
        <Box sx={{ mb: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
            <RemoteOriginChip video={video} />
            {video.availability === 'offline' && (
                <Alert severity="warning" sx={{ width: '100%' }}>
                    {t('federationItemOffline', { name: remoteInstanceName(video) ?? '' })}
                </Alert>
            )}
        </Box>
    );
};

export default RemoteOriginNotice;
