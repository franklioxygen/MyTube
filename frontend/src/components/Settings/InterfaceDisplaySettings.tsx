import { Box, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Switch, TextField } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface InterfaceDisplaySettingsProps {
    itemsPerPage?: number;
    showYoutubeSearch?: boolean;
    infiniteScroll?: boolean;
    videoColumns?: number;
    onChange: (field: string, value: string | number | boolean) => void;
}

const InterfaceDisplaySettings: React.FC<InterfaceDisplaySettingsProps> = (props) => {
    const { itemsPerPage, showYoutubeSearch, infiniteScroll, videoColumns, onChange } = props;
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
            </Box>
        </Box>
    );
};

export default InterfaceDisplaySettings;
