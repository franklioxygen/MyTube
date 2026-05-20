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
import { FormEvent, useRef } from 'react';
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
    const inputRef = useRef<HTMLInputElement | null>(null);

    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const pasteIntoInputFallback = async (): Promise<string> => {
        const input = inputRef.current;
        if (!input) {
            throw new Error('Search input is unavailable');
        }

        const previousValue = input.value;
        input.focus();
        input.select();

        const pasted = document.execCommand('paste');
        if (pasted && input.value !== previousValue) {
            return input.value;
        }

        throw new Error('Clipboard paste is unavailable');
    };

    const readClipboardText = async (): Promise<string> => {
        const clipboardReadText =
            typeof navigator.clipboard?.readText === 'function'
                ? navigator.clipboard.readText.bind(navigator.clipboard)
                : null;

        if (clipboardReadText) {
            try {
                return await clipboardReadText();
            } catch {
                return pasteIntoInputFallback();
            }
        }

        return pasteIntoInputFallback();
    };

    const handlePaste = async () => {
        try {
            const text = await readClipboardText();
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
                placeholder={isVisitor ? t('enterSearchTerm') : t('enterUrlOrSearchTerm')}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                inputRef={inputRef}
                disabled={isSubmitting}
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
                                    type="button"
                                    disabled={isSubmitting}
                                    sx={{ ml: 0 }}
                                >
                                    <ContentPaste />
                                </IconButton>
                            </InputAdornment>
                        ) : null,
                        endAdornment: (
                            <InputAdornment position="end">
                                {isSearchMode && searchTerm && videoUrl && (
                                    <IconButton onClick={onResetSearch} edge="end" size="small" type="button" sx={{ mr: 0.5 }}>
                                        <Clear />
                                    </IconButton>
                                )}
                                {videoUrl && (
                                    <IconButton
                                        onClick={handleClear}
                                        edge="end"
                                        size="small"
                                        type="button"
                                        disabled={isSubmitting}
                                        sx={{ mr: 0.5 }}
                                    >
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
