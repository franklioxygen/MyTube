import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Link,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSettings } from '../hooks/useSettings';
import { useDownloadAudioOnlyPreference } from '../hooks/useDownloadAudioOnlyPreference';
import DialogHeader from './DialogHeader';

interface DownloadConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoTitle?: string;
  sourceUrl: string;
  onConfirm: (options: { audioOnly: boolean }) => void | Promise<unknown>;
  isMissAV: boolean;
}

const DownloadConfirmModal: React.FC<DownloadConfirmModalProps> = ({
  isOpen,
  onClose,
  videoTitle = 'Pending...',
  sourceUrl,
  onConfirm,
  isMissAV,
}) => {
  const { t } = useLanguage();
  const { data: settings } = useSettings();
  const [initialValue, persist] = useDownloadAudioOnlyPreference();
  const [audioOnly, setAudioOnly] = useState(initialValue);

  useEffect(() => {
    if (isOpen) {
      setAudioOnly(initialValue);
    }
  }, [initialValue, isOpen, sourceUrl]);

  const handleConfirm = async () => {
    const confirmedAudioOnly = !isMissAV && audioOnly;
    persist(confirmedAudioOnly);
    await onConfirm({ audioOnly: confirmedAudioOnly });
  };

  return (
    <Dialog open={isOpen} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogHeader
        title={t('downloadOptions') || 'Download options'}
        onClose={onClose}
        closeLabel={t('close')}
      />
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {sourceUrl}
        </Typography>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {videoTitle || t('pending') || 'Pending...'}
        </Typography>

        {!isMissAV && (
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={audioOnly}
                  onChange={(event) => setAudioOnly(event.target.checked)}
                />
              }
              label={t('downloadAudioOnly') || 'Download audio only'}
            />
            {audioOnly && (
              <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                {t('downloadAudioOnlyHint') || 'Stores only the audio track (no video).'}{' '}
                {t('audioFormat') || 'Format'}: {(settings?.audioFormat || 'm4a').toUpperCase()}.{' '}
                <Link href="/settings">{t('settings') || 'Settings'}</Link>
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit">
          {t('cancel') || 'Cancel'}
        </Button>
        <Button onClick={handleConfirm} variant="contained">
          {t('download') || 'Download'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DownloadConfirmModal;
