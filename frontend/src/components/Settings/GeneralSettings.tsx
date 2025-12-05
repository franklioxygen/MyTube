import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface GeneralSettingsProps {
    language: string;
    onChange: (value: string) => void;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ language, onChange }) => {
    const { t } = useLanguage();

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('general')}</Typography>
            <Box sx={{ maxWidth: 400 }}>
                <FormControl fullWidth>
                    <InputLabel id="language-select-label">{t('language')}</InputLabel>
                    <Select
                        labelId="language-select-label"
                        id="language-select"
                        value={language || 'en'}
                        label={t('language')}
                        onChange={(e) => onChange(e.target.value)}
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
            </Box>
        </Box>
    );
};

export default GeneralSettings;
