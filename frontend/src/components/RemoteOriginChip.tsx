import DnsIcon from '@mui/icons-material/Dns';
import { Chip, type SxProps, type Theme, Tooltip } from '@mui/material';
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Video } from '../types';
import { remoteInstanceName } from '../utils/libraryItem';

interface RemoteOriginChipProps {
    video: Pick<Video, 'origin' | 'availability'>;
    sx?: SxProps<Theme>;
}

/** Names the instance a remote item comes from, and warns when it is out of date. */
const RemoteOriginChip: React.FC<RemoteOriginChipProps> = ({ video, sx }) => {
    const { t } = useLanguage();
    const name = remoteInstanceName(video);
    if (name === null) return null;

    const degraded = video.availability === 'stale' || video.availability === 'offline';
    const title = video.availability === 'offline'
        ? t('federationItemOffline', { name })
        : video.availability === 'stale'
            ? t('federationItemStale', { name })
            : t('federationFromInstance', { name });

    return (
        <Tooltip title={title}>
            <Chip
                icon={<DnsIcon />}
                label={name}
                size="small"
                color={degraded ? 'warning' : 'info'}
                aria-label={title}
                sx={sx}
            />
        </Tooltip>
    );
};

export default RemoteOriginChip;
