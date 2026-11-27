import { Box, FormControl, FormControlLabel, MenuItem, Select, Switch, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { sponsorBlockCategory } from '../../theme/colors';
import type { Settings, SponsorBlockCategory, SponsorBlockMode } from '../../types';
import {
    resolveSponsorBlockCategories,
    SPONSORBLOCK_CATEGORIES,
    SPONSORBLOCK_CATEGORY_DESCRIPTION_KEYS,
    SPONSORBLOCK_CATEGORY_LABEL_KEYS,
} from '../../utils/sponsorBlock';
import type { TranslationKey } from '../../utils/translations';
import { SETTINGS_CONTROL_MAX_WIDTH } from './settingsLayout';

interface SponsorBlockSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const MODE_LABEL_KEYS: Record<SponsorBlockMode, TranslationKey> = {
    auto: 'sponsorBlockModeAuto',
    manual: 'sponsorBlockModeManual',
    off: 'sponsorBlockModeOff',
};
const MODES: SponsorBlockMode[] = ['auto', 'manual', 'off'];

/** Playback-time SponsorBlock skipping for YouTube videos (issue #555). */
const SponsorBlockSettings: React.FC<SponsorBlockSettingsProps> = ({ settings, onChange }) => {
    const { t } = useLanguage();
    const enabled = settings.sponsorBlockEnabled === true;
    const categories = resolveSponsorBlockCategories(settings);

    const changeMode = (category: SponsorBlockCategory, mode: SponsorBlockMode) => {
        onChange('sponsorBlockCategories', { ...categories, [category]: mode });
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6">{t('sponsorBlockTitle')}</Typography>
            <Typography variant="body2" color="text.secondary">
                {t('sponsorBlockDescription')}
            </Typography>
            <FormControlLabel
                control={
                    <Switch
                        checked={enabled}
                        onChange={(event) => onChange('sponsorBlockEnabled', event.target.checked)}
                    />
                }
                label={t('sponsorBlockEnable')}
            />
            {enabled && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {SPONSORBLOCK_CATEGORIES.map((category) => {
                        const labelId = `sponsorblock-${category}-label`;
                        return (
                            <Box key={category} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box
                                        aria-hidden="true"
                                        sx={{
                                            width: 12,
                                            height: 12,
                                            borderRadius: 0.5,
                                            flexShrink: 0,
                                            bgcolor: sponsorBlockCategory[category],
                                            border: 1,
                                            borderColor: 'divider',
                                        }}
                                    />
                                    <Typography id={labelId} variant="subtitle2">
                                        {t(SPONSORBLOCK_CATEGORY_LABEL_KEYS[category])}
                                    </Typography>
                                </Box>
                                <Typography variant="body2" color="text.secondary">
                                    {t(SPONSORBLOCK_CATEGORY_DESCRIPTION_KEYS[category])}
                                </Typography>
                                <FormControl size="small" sx={{ maxWidth: SETTINGS_CONTROL_MAX_WIDTH }} fullWidth>
                                    <Select
                                        labelId={labelId}
                                        value={categories[category] ?? 'off'}
                                        onChange={(event) => changeMode(category, event.target.value as SponsorBlockMode)}
                                    >
                                        {MODES.map((mode) => (
                                            <MenuItem key={mode} value={mode}>
                                                {t(MODE_LABEL_KEYS[mode])}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Box>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
};

export default SponsorBlockSettings;
