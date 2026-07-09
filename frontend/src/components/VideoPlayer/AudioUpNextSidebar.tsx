import { Add, Equalizer, MusicNote, PlayArrow } from '@mui/icons-material';
import {
  Box,
  Card,
  CardMedia,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import { Video } from '../../types';
import { getBackendUrl } from '../../utils/apiUrl';
import { formatDuration } from '../../utils/formatUtils';
import { buildSmallThumbnailAbsoluteUrl } from '../../utils/imageOptimization';
import { overlay, neutral, brand } from '../../theme/colors';
import { THUMBNAIL_PLACEHOLDER_SRC, setThumbnailPlaceholder } from '../../utils/thumbnailPlaceholder';

interface AudioUpNextSidebarProps {
  relatedVideos: Video[];
  autoPlayNext: boolean;
  onAutoPlayNextChange: (checked: boolean) => void;
  onVideoClick: (videoId: string, position: number) => void;
  onAddToCollection: (videoId: string) => void;
  currentVideoId?: string;
}

const AudioTrackThumbnail: React.FC<{ video: Video }> = ({ video }) => {
  const isCloud = video.videoPath?.startsWith('cloud:') ?? false;
  const cloudUrl = useCloudStorageUrl(isCloud ? video.thumbnailPath : null, 'thumbnail');
  const localUrl = !isCloud
    ? buildSmallThumbnailAbsoluteUrl(getBackendUrl(), video.thumbnailPath, video.thumbnailUrl)
    : undefined;

  return (
    <CardMedia
      component="img"
      loading="lazy"
      image={cloudUrl || localUrl || video.thumbnailUrl || THUMBNAIL_PLACEHOLDER_SRC}
      alt=""
      onError={(event) => setThumbnailPlaceholder(event.currentTarget)}
      sx={{ width: 56, height: 56, flexShrink: 0, borderRadius: 1.5, objectFit: 'cover' }}
    />
  );
};

const AudioUpNextSidebar: React.FC<AudioUpNextSidebarProps> = ({
  relatedVideos,
  autoPlayNext,
  onAutoPlayNextChange,
  onVideoClick,
  onAddToCollection,
  currentVideoId,
}) => {
  const { t } = useLanguage();
  const { userRole } = useAuth();
  const isVisitor = userRole === 'visitor';
  const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <Box sx={{ p: { xs: 2, md: 0 }, pt: { xs: 2, md: 0 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight="bold">{t('upNext')}</Typography>
        <FormControlLabel
          control={<Switch checked={autoPlayNext} onChange={(event) => onAutoPlayNextChange(event.target.checked)} size="small" />}
          label={<Typography variant="body2">{t('autoPlayNext')}</Typography>}
          labelPlacement="start"
          sx={{ ml: 0, mr: 0 }}
        />
      </Stack>

      <Stack spacing={0.5}>
        {relatedVideos.map((relatedVideo, index) => {
          const isCurrent = relatedVideo.id === currentVideoId;
          const isAudio = relatedVideo.mediaType === 'audio';
          return (
            <Card
              key={relatedVideo.id}
              elevation={0}
              onClick={() => onVideoClick(relatedVideo.id, index)}
              onMouseEnter={() => setHoveredId(relatedVideo.id)}
              onMouseLeave={() => setHoveredId(null)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                p: 0.75,
                cursor: 'pointer',
                bgcolor: isCurrent ? 'action.selected' : 'transparent',
                borderRadius: 1.5,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <AudioTrackThumbnail video={relatedVideo} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={isCurrent ? 700 : 600} noWrap>
                  {relatedVideo.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {relatedVideo.author}
                </Typography>
              </Box>
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
                {isCurrent ? (
                  <Equalizer sx={{ color: brand.primaryDark, fontSize: 19 }} aria-label="Playing" />
                ) : (
                  <Tooltip title={isAudio ? 'Audio' : 'Video'}>
                    {isAudio ? <MusicNote sx={{ fontSize: 17, color: 'text.secondary' }} /> : <PlayArrow sx={{ fontSize: 17, color: 'text.secondary' }} />}
                  </Tooltip>
                )}
                <Typography variant="caption" color="text.secondary">
                  {formatDuration(relatedVideo.duration || '')}
                </Typography>
              </Stack>
              {hoveredId === relatedVideo.id && !isTouch && !isVisitor && (
                <Tooltip title={t('addToCollection')}>
                  <IconButton
                    size="small"
                    onClick={(event) => { event.stopPropagation(); onAddToCollection(relatedVideo.id); }}
                    sx={{ color: neutral.white, bgcolor: overlay.black70, p: 0.35 }}
                  >
                    <Add fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Card>
          );
        })}
      </Stack>
      {relatedVideos.length === 0 && (
        <Typography variant="body2" color="text.secondary">{t('noOtherVideos')}</Typography>
      )}
    </Box>
  );
};

export default AudioUpNextSidebar;
