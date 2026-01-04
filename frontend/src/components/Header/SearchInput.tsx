import { Clear, ContentPaste, Search } from '@mui/icons-material';
import {
    alpha,
    Box,
    Button,
    CircularProgress,
    IconButton,
    InputAdornment,
    TextField,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';
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
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            setVideoUrl(text);
        } catch (err) {
            console.error('Failed to paste from clipboard:', err);
        }
    };

    const handleClear = () => {
        setVideoUrl('');
    };

    return (
        <Box component="form" onSubmit={onSubmit} sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', width: '100%' }}>
            <TextField
                fullWidth
                variant="outlined"
                placeholder={isVisitor ? t('visitorModeReadOnly') || 'Visitor mode: Read-only' : t('enterUrlOrSearchTerm')}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                disabled={isSubmitting || isVisitor}
                error={!!error}
                helperText={error}
                size="small"
                sx={{
                    '& .MuiOutlinedInput-root': {
                        bgcolor: !isMobile ? alpha(theme.palette.background.paper, 0.1) : 'background.paper',
                        backdropFilter: !isMobile ? 'blur(10px)' : 'none',
                    }
                }}
                slotProps={{
                    input: {
                        startAdornment: !isMobile ? (
                            <InputAdornment position="start">
                                <IconButton
                                    onClick={handlePaste}
                                    edge="start"
                                    size="small"
                                    disabled={isSubmitting || isVisitor}
                                    sx={{ ml: 0 }}
                                >
                                    <ContentPaste />
                                </IconButton>
                            </InputAdornment>
                        ) : null,
                        endAdornment: (
                            <InputAdornment position="end">
                                {isSearchMode && searchTerm && videoUrl && (
                                    <IconButton onClick={onResetSearch} edge="end" size="small" sx={{ mr: 0.5 }}>
                                        <Clear />
                                    </IconButton>
                                )}
                                {videoUrl && (
                                    <IconButton
                                        onClick={handleClear}
                                        edge="end"
                                        size="small"
                                        disabled={isSubmitting || isVisitor}
                                        sx={{ mr: 0.5 }}
                                    >
                                        <Clear />
                                    </IconButton>
                                )}
                                <Button
                                    type="submit"
                                    variant="contained"
                                    disabled={isSubmitting || isVisitor}
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

