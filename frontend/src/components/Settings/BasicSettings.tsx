import { Box, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Switch, TextField } from '@mui/material';
import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { ThemePreference } from '../../contexts/ThemeContext';

interface BasicSettingsProps {
    language: string;
    theme?: ThemePreference;
    showThemeButton?: boolean;
    websiteName?: string;
    onChange: (field: string, value: string | number | boolean) => void;
}

const BasicSettings: React.FC<BasicSettingsProps> = ({ language, theme, showThemeButton = true, websiteName, onChange }) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';

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

                <FormControl fullWidth>
                    <InputLabel id="theme-select-label">{t('theme')}</InputLabel>
                    <Select
                        labelId="theme-select-label"
                        id="theme-select"
                        value={theme || 'system'}
                        label={t('theme')}
                        onChange={(e) => onChange('theme', e.target.value)}
                    >
                        <MenuItem value="light">{t('themeLight')}</MenuItem>
                        <MenuItem value="dark">{t('themeDark')}</MenuItem>
                        <MenuItem value="system">{t('themeSystem')}</MenuItem>
                    </Select>
                </FormControl>

                {!isVisitor && (
                    <FormControlLabel
                        control={
                            <Switch
                                checked={showThemeButton !== false}
                                onChange={(e) => onChange('showThemeButton', e.target.checked)}
                                color="primary"
                            />
                        }
                        label={t('showThemeButtonInHeader')}
                    />
                )}

                {!isVisitor && (
                    <>
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
                    </>
                )}
            </Box>
        </Box >
    );
};

export default BasicSettings;
