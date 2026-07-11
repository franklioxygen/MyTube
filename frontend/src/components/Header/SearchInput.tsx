import { Audiotrack, Clear, ContentPaste, Search } from '@mui/icons-material';
import {
    alpha,
    Box,
    ButtonGroup,
    Button,
    CircularProgress,
    IconButton,
    InputAdornment,
    TextField,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { FormEvent, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { isMissAVUrl } from '../../utils/missav';

interface SearchInputProps {
    videoUrl: string;
    setVideoUrl: (url: string) => void;
    isSubmitting: boolean;
    error: string;
    isSearchMode: boolean;
    onResetSearch?: () => void;
    onSubmit: (e: FormEvent) => void;
    onAudioSubmit?: (url: string) => Promise<unknown>;
    showAudioDownloadButton?: boolean;
}

const SearchInput: React.FC<SearchInputProps> = ({
    videoUrl,
    setVideoUrl,
    isSubmitting,
    error,
    isSearchMode,
    onResetSearch,
    onSubmit,
    onAudioSubmit,
    showAudioDownloadButton = true,
}) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const inputRef = useRef<HTMLInputElement | null>(null);

    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [isFocused, setIsFocused] = useState(false);

    const isSearchActive = isMobile || isFocused || !!videoUrl || !!error || isSubmitting;
    const desktopTransition = 'opacity 0.3s ease-in-out, background-color 0.3s ease-in-out, border-color 0.3s ease-in-out';
    const inactiveBorderColor = alpha(theme.palette.text.primary, 0.12);
    const activeBorderColor = alpha(theme.palette.text.primary, 0.23);
    const canDownloadAudio = Boolean(
        !isVisitor &&
        showAudioDownloadButton &&
        onAudioSubmit &&
        /^https?:\/\/[^\s]+$/i.test(videoUrl.trim()) &&
        !isMissAVUrl(videoUrl.trim()),
    );
    const isMissAVInput = isMissAVUrl(videoUrl.trim());

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
        // Also reset the global search state when active, so clearing the
        // input also dismisses stale search results (single unified "clear").
        if (isSearchMode) {
            onResetSearch?.();
        }
    };

    const handleAudioDownload = () => {
        if (!canDownloadAudio || !onAudioSubmit) return;

        void onAudioSubmit(videoUrl.trim());
    };

    return (
        <Box component="form" onSubmit={onSubmit} sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', width: '100%' }}>
            <TextField
                fullWidth
                variant="outlined"
                placeholder={isVisitor ? t('enterSearchTerm') : t('enterUrlOrSearchTerm')}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                inputRef={inputRef}
                disabled={isSubmitting}
                error={!!error}
                helperText={error}
                size="small"
                sx={{
                    '& .MuiOutlinedInput-root': {
                        bgcolor: !isMobile
                            ? alpha(theme.palette.background.paper, isSearchActive ? 0.1 : 0.04)
                            : 'background.paper',
                        backdropFilter: !isMobile ? 'blur(10px)' : 'none',
                        opacity: !isMobile && !isSearchActive ? 0.55 : 1,
                        transition: desktopTransition,
                        ...(!isMobile && !isSearchActive && {
                            '&:hover': {
                                opacity: 0.75,
                            },
                        }),
                        '& fieldset': {
                            borderColor: !isMobile && !isSearchActive ? inactiveBorderColor : activeBorderColor,
                            transition: 'border-color 0.3s ease-in-out',
                        },
                        '&:hover fieldset': {
                            borderColor: !isMobile && !isSearchActive
                                ? alpha(theme.palette.text.primary, 0.2)
                                : undefined,
                        },
                        '&.Mui-focused fieldset': {
                            borderColor: theme.palette.primary.main,
                        },
                    },
                    '& .MuiInputBase-input::placeholder': {
                        opacity: !isMobile && !isSearchActive ? 0.45 : 0.7,
                        transition: 'opacity 0.3s ease-in-out',
                    },
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
                                    aria-label={t('pasteUrl')}
                                    disabled={isSubmitting}
                                    sx={{ ml: 0 }}
                                >
                                    <ContentPaste />
                                </IconButton>
                            </InputAdornment>
                        ) : null,
                        endAdornment: (
                            <InputAdornment position="end">
                                {videoUrl && (
                                    <IconButton
                                        onClick={handleClear}
                                        edge="end"
                                        size="small"
                                        type="button"
                                        aria-label={t('clear')}
                                        disabled={isSubmitting}
                                        sx={{ mr: 0.5 }}
                                    >
                                        <Clear />
                                    </IconButton>
                                )}
                                <ButtonGroup
                                    variant="contained"
                                    disabled={isSubmitting}
                                    sx={{
                                        height: '100%',
                                        borderRadius: 2,
                                        overflow: 'hidden',
                                        boxShadow: 'none',
                                        '& .MuiButton-root': {
                                            minHeight: '100%',
                                            borderRadius: 0,
                                            transition: desktopTransition,
                                        },
                                        '& .MuiButton-root:first-of-type': {
                                            borderTopLeftRadius: 2,
                                            borderBottomLeftRadius: 2,
                                        },
                                        '& .MuiButton-root:last-of-type': {
                                            borderTopRightRadius: 2,
                                            borderBottomRightRadius: 2,
                                        },
                                        '& .MuiButton-root + .MuiButton-root': {
                                            borderLeft: `1px solid ${alpha(theme.palette.primary.contrastText, 0.32)}`,
                                        },
                                        ...(!isMobile && !isSearchActive && {
                                            '& .MuiButton-root': {
                                                bgcolor: alpha(theme.palette.primary.main, 0.35),
                                                color: alpha(theme.palette.primary.contrastText, 0.85),
                                                boxShadow: 'none',
                                                '&:hover': {
                                                    bgcolor: alpha(theme.palette.primary.main, 0.5),
                                                    boxShadow: 'none',
                                                },
                                            },
                                        }),
                                    }}
                                >
                                    <Button
                                        type="submit"
                                        aria-label={t('download')}
                                        sx={{ minWidth: 'auto', px: 2.5 }}
                                    >
                                        {isSubmitting ? <CircularProgress size={24} color="inherit" /> : <Search />}
                                    </Button>
                                    {!isVisitor && showAudioDownloadButton && !isMissAVInput && (
                                        <Button
                                            type="button"
                                            aria-label={t('downloadAudioOnly')}
                                            title={t('downloadAudioOnly')}
                                            onClick={handleAudioDownload}
                                            disabled={!canDownloadAudio}
                                            sx={{ minWidth: 42, px: 1 }}
                                        >
                                            <Audiotrack fontSize="small" />
                                        </Button>
                                    )}
                                </ButtonGroup>
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
