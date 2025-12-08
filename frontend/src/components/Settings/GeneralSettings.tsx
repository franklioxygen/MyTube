import { Box, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface GeneralSettingsProps {
    language: string;
    websiteName?: string;
    itemsPerPage?: number;
    onChange: (field: string, value: string | number) => void;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = (props) => {
    const { language, websiteName, onChange } = props;
    const { t } = useLanguage();

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('general')}</Typography>
            <Box sx={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <FormControl fullWidth>
                    <InputLabel id="language-select-label">{t('language')}</InputLabel>
                    <Select
                        labelId="language-select-label"
                        id="language-select"
                        value={language || 'en'}
                        label={t('language')}
                        onChange={(e) => onChange('language', e.target.value)}
                    >
                        <MenuItem value="en">English</MenuItem>
                        <MenuItem value="zh">中文 (Chinese)</MenuItem>
                        <MenuItem value="es">Español (Spanish)</MenuItem>
                        <MenuItem value="de">Deutsch (German)</MenuItem>
                        <MenuItem value="ja">日本語 (Japanese)</MenuItem>
                        <MenuItem value="fr">Français (French)</MenuItem>
                        <MenuItem value="ko">한국어 (Korean)</MenuItem>
                        <MenuItem value="ar">العربية (Arabic)</MenuItem>
                        <MenuItem value="pt">Português (Portuguese)</MenuItem>
                        <MenuItem value="ru">Русский (Russian)</MenuItem>
                    </Select>
                </FormControl>

                <TextField
                    fullWidth
                    label="Website Name"
                    value={websiteName || ''}
                    onChange={(e) => onChange('websiteName', e.target.value)}
                    placeholder="MyTube"
                    helperText={`${(websiteName || '').length}/15 characters (Default: MyTube)`}
                    slotProps={{ htmlInput: { maxLength: 15 } }}
                />

                <TextField
                    fullWidth
                    label={t('itemsPerPage') || "Items Per Page"}
                    type="number"
                    value={props.itemsPerPage || 12}
                    onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val > 0) {
                            onChange('itemsPerPage', val);
                        }
                    }}
                    helperText={t('itemsPerPageHelper') || "Number of videos to show per page (Default: 12)"}
                    slotProps={{ htmlInput: { min: 1 } }}
                />
            </Box>
        </Box>
    );
};

export default GeneralSettings;
