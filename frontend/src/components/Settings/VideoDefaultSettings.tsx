import { Box, FormControlLabel, Switch } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import {
    DEFAULT_PLAYER_SEEK_INTERVALS,
    isValidPlayerSeekSeconds,
} from '../../utils/playerSeekIntervals';
import SeekIntervalSettings from './SeekIntervalSettings';

interface VideoDefaultSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
    onSeekIntervalsValidityChange?: (valid: boolean) => void;
}

const noopValidityChange = () => undefined;

const VideoDefaultSettings: React.FC<VideoDefaultSettingsProps> = ({
    settings,
    onChange,
    onSeekIntervalsValidityChange = noopValidityChange,
}) => {
    const { t } = useLanguage();
    const seekIntervals = {
        shortSeconds: isValidPlayerSeekSeconds(settings.playerSeekShortSeconds)
            ? settings.playerSeekShortSeconds
            : DEFAULT_PLAYER_SEEK_INTERVALS.shortSeconds,
        mediumSeconds: isValidPlayerSeekSeconds(settings.playerSeekMediumSeconds)
            ? settings.playerSeekMediumSeconds
            : DEFAULT_PLAYER_SEEK_INTERVALS.mediumSeconds,
        longSeconds: isValidPlayerSeekSeconds(settings.playerSeekLongSeconds)
            ? settings.playerSeekLongSeconds
            : DEFAULT_PLAYER_SEEK_INTERVALS.longSeconds,
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.defaultAutoPlay}
                            onChange={(e) => onChange('defaultAutoPlay', e.target.checked)}
                        />
                    }
                    label={t('autoPlay')}
                />
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.pauseOnFocusLoss || false}
                            onChange={(e) => onChange('pauseOnFocusLoss', e.target.checked)}
                        />
                    }
                    label={t('pauseOnFocusLoss')}
                />
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.playFromBeginning || false}
                            onChange={(e) => onChange('playFromBeginning', e.target.checked)}
                        />
                    }
                    label={t('playFromBeginning')}
                />
                <SeekIntervalSettings
                    intervals={seekIntervals}
                    onChange={onChange}
                    onValidityChange={onSeekIntervalsValidityChange}
                />
            </Box>
        </Box>
    );
};

export default VideoDefaultSettings;
