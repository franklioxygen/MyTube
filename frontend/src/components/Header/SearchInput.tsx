import { Clear, Search } from '@mui/icons-material';
import {
    Box,
    Button,
    CircularProgress,
    IconButton,
    InputAdornment,
    TextField
} from '@mui/material';
import { FormEvent } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface SearchInputProps {
    videoUrl: string;
    setVideoUrl: (url: string) => void;
    isSubmitting: boolean;
    error: string;
    isSearchMode: boolean;
    searchTerm: string;
    onResetSearch?: () => void;
    onSubmit: (e: FormEvent) => void;
}

const SearchInput: React.FC<SearchInputProps> = ({
    videoUrl,
    setVideoUrl,
    isSubmitting,
    error,
    isSearchMode,
    searchTerm,
    onResetSearch,
    onSubmit
}) => {
    const { t } = useLanguage();

    return (
        <Box component="form" onSubmit={onSubmit} sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', width: '100%' }}>
            <TextField
                fullWidth
                variant="outlined"
                placeholder={t('enterUrlOrSearchTerm')}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                disabled={isSubmitting}
                error={!!error}
                helperText={error}
                size="small"
                slotProps={{
                    input: {
                        endAdornment: (
                            <InputAdornment position="end">
                                {isSearchMode && searchTerm && (
                                    <IconButton onClick={onResetSearch} edge="end" size="small" sx={{ mr: 0.5 }}>
                                        <Clear />
                                    </IconButton>
                                )}
                                <Button
                                    type="submit"
                                    variant="contained"
                                    disabled={isSubmitting}
                                    sx={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, height: '100%', minWidth: 'auto', px: 3 }}
                                >
                                    {isSubmitting ? <CircularProgress size={24} color="inherit" /> : <Search />}
                                </Button>
                            </InputAdornment>
                        ),
                        sx: { pr: 0, borderRadius: 2 }
                    }
                }}
            />
        </Box>
    );
};

export default SearchInput;

