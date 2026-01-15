import { Box, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Switch, TextField, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { INFO_SOUNDS, SOUND_OPTIONS } from '../../utils/sounds';

interface InterfaceDisplaySettingsProps {
    itemsPerPage?: number;
    showYoutubeSearch?: boolean;
    infiniteScroll?: boolean;
    videoColumns?: number;
    playSoundOnTaskComplete?: string;
    defaultSort?: string;
    onChange: (field: string, value: string | number | boolean) => void;
}

const InterfaceDisplaySettings: React.FC<InterfaceDisplaySettingsProps> = (props) => {
    const { itemsPerPage, showYoutubeSearch, infiniteScroll, videoColumns, playSoundOnTaskComplete, onChange } = props;
    const { t } = useLanguage();

    return (
        <Box>
            <Box sx={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <TextField
                    fullWidth
                    label={t('itemsPerPage') || "Items Per Page"}
                    type="number"
                    value={itemsPerPage || 12}
                    onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val > 0) {
                            onChange('itemsPerPage', val);
                        }
                    }}
                    disabled={infiniteScroll ?? false}
                    helperText={
                        infiniteScroll
                            ? t('infiniteScrollDisabled') || "Disabled when Infinite Scroll is enabled"
                            : (t('itemsPerPageHelper') || "Number of videos to show per page (Default: 12)")
                    }
                    slotProps={{ htmlInput: { min: 1 } }}
                />

                <FormControl fullWidth>
                    <InputLabel id="video-columns-select-label">{t('maxVideoColumns') || 'Maximum Video Columns (Homepage)'}</InputLabel>
                    <Select
                        labelId="video-columns-select-label"
                        id="video-columns-select"
                        value={videoColumns || 4}
                        label={t('videoColumns') || 'Video Columns (Homepage)'}
                        onChange={(e) => onChange('videoColumns', Number(e.target.value))}
                    >
                        <MenuItem value={2}>{t('columnsCount', { count: 2 }) || '2 Columns'}</MenuItem>
                        <MenuItem value={3}>{t('columnsCount', { count: 3 }) || '3 Columns'}</MenuItem>
                        <MenuItem value={4}>{t('columnsCount', { count: 4 }) || '4 Columns'}</MenuItem>
                        <MenuItem value={5}>{t('columnsCount', { count: 5 }) || '5 Columns'}</MenuItem>
                        <MenuItem value={6}>{t('columnsCount', { count: 6 }) || '6 Columns'}</MenuItem>
                    </Select>
                </FormControl>

                <FormControlLabel
                    control={
                        <Switch
                            checked={infiniteScroll ?? false}
                            onChange={(e) => onChange('infiniteScroll', e.target.checked)}
                        />
                    }
                    label={t('infiniteScroll') || "Infinite Scroll"}
                />

                <FormControlLabel
                    control={
                        <Switch
                            checked={showYoutubeSearch ?? true}
                            onChange={(e) => onChange('showYoutubeSearch', e.target.checked)}
                        />
                    }
                    label={t('showYoutubeSearch') || "Show YouTube Search Results"}
                />

                <Box>
                    <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500 }}>
                        {t('playSoundOnTaskComplete') || "Play Sound on Task Complete"}
                    </Typography>
                    <FormControl fullWidth>
                        <Select
                            id="sound-select"
                            value={playSoundOnTaskComplete || ''}
                            onChange={(e) => {
                                const newValue = e.target.value;
                                onChange('playSoundOnTaskComplete', newValue);

                                // Play the selected sound for preview
                                if (newValue && SOUND_OPTIONS.find(opt => opt.value === newValue)) {
                                    const soundFile = SOUND_OPTIONS.find(opt => opt.value === newValue)?.value;
                                    if (soundFile && INFO_SOUNDS[soundFile]) {
                                        const audio = new Audio(INFO_SOUNDS[soundFile]);
                                        audio.play().catch(console.error);
                                    }
                                }
                            }}
                            displayEmpty
                        >
                            {SOUND_OPTIONS.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                    {t(option.labelKey) || option.labelKey}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Box>
                <Box>
                    <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500 }}>
                        {t('defaultSort') || "Default Video Sort Method"}
                    </Typography>
                    <FormControl fullWidth>
                        <Select
                            id="default-sort-select"
                            value={props.defaultSort || 'dateDesc'}
                            onChange={(e) => onChange('defaultSort', e.target.value)}
                        >
                            <MenuItem value="dateDesc">{t('dateDesc') || 'Date Added (Newest)'}</MenuItem>
                            <MenuItem value="dateAsc">{t('dateAsc') || 'Date Added (Oldest)'}</MenuItem>
                            <MenuItem value="videoDateDesc">{t('videoDateDesc') || 'Video Create Date (Newest)'}</MenuItem>
                            <MenuItem value="videoDateAsc">{t('videoDateAsc') || 'Video Create Date (Oldest)'}</MenuItem>
                            <MenuItem value="viewsDesc">{t('viewsDesc') || 'Views (High to Low)'}</MenuItem>
                            <MenuItem value="viewsAsc">{t('viewsAsc') || 'Views (Low to High)'}</MenuItem>
                            <MenuItem value="nameAsc">{t('nameAsc') || 'Name (A-Z)'}</MenuItem>
                            <MenuItem value="random">{t('random') || 'Random Shuffle'}</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
            </Box>
        </Box>
    );
};

export default InterfaceDisplaySettings;
