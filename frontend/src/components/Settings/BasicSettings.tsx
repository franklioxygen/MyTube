import { Box, FormControl, InputLabel, MenuItem, Select, TextField } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface BasicSettingsProps {
    language: string;
    websiteName?: string;
    onChange: (field: string, value: string | number | boolean) => void;
}

const BasicSettings: React.FC<BasicSettingsProps> = ({ language, websiteName, onChange }) => {
    const { t } = useLanguage();

    return (
        <Box>
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
                    label={t('websiteName')}
                    value={websiteName || ''}
                    onChange={(e) => onChange('websiteName', e.target.value)}
                    placeholder="MyTube"
                    helperText={t('websiteNameHelper', {
                        current: (websiteName || '').length,
                        max: 15,
                        default: 'MyTube'
                    })}
                    slotProps={{ htmlInput: { maxLength: 15 } }}
                />
            </Box>
        </Box>
    );
};

export default BasicSettings;
