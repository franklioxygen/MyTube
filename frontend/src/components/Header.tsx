import {
    Brightness4,
    Brightness7,
    Clear,
    CloudUpload,
    Download,
    Menu as MenuIcon,
    Search,
    Settings,
    VideoLibrary
} from '@mui/icons-material';
import {
    AppBar,
    Badge,
    Box,
    Button,
    CircularProgress,
    Collapse,
    IconButton,
    InputAdornment,
    Menu,
    MenuItem,
    Stack,
    TextField,
    Toolbar,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import logo from '../assets/logo.svg';
import { Collection, Video } from '../types';
import AuthorsList from './AuthorsList';
import Collections from './Collections';
import UploadModal from './UploadModal';

interface DownloadInfo {
    id: string;
    title: string;
    timestamp?: number;
}

interface HeaderProps {
    onSubmit: (url: string) => Promise<any>;
    onSearch: (term: string) => Promise<any>;
    activeDownloads?: DownloadInfo[];
    isSearchMode?: boolean;
    searchTerm?: string;
    onResetSearch?: () => void;
    theme: string;
    toggleTheme: () => void;
    collections?: Collection[];
    videos?: Video[];
}

const Header: React.FC<HeaderProps> = ({
    onSubmit,
    onSearch,
    activeDownloads = [],
    isSearchMode = false,
    searchTerm = '',
    onResetSearch,
    theme: currentThemeMode,
    toggleTheme,
    collections = [],
    videos = []
}) => {
    const [videoUrl, setVideoUrl] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [manageAnchorEl, setManageAnchorEl] = useState<null | HTMLElement>(null);
    const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
    const navigate = useNavigate();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));


    const isDownloading = activeDownloads.length > 0;

    useEffect(() => {
        console.log('Header props:', { activeDownloads });
    }, [activeDownloads]);

    const handleDownloadsClick = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleDownloadsClose = () => {
        setAnchorEl(null);
    };

    const handleManageClick = (event: React.MouseEvent<HTMLElement>) => {
        setManageAnchorEl(event.currentTarget);
    };

    const handleManageClose = () => {
        setManageAnchorEl(null);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        if (!videoUrl.trim()) {
            setError('Please enter a video URL or search term');
            return;
        }

        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
        const bilibiliRegex = /^(https?:\/\/)?(www\.)?(bilibili\.com|b23\.tv)\/.+$/;
        const isUrl = youtubeRegex.test(videoUrl) || bilibiliRegex.test(videoUrl);

        setError('');
        setIsSubmitting(true);

        try {
            if (isUrl) {
                const result = await onSubmit(videoUrl);
                if (result.success) {
                    setVideoUrl('');
                    setMobileMenuOpen(false);
                } else if (result.isSearchTerm) {
                    const searchResult = await onSearch(videoUrl);
                    if (searchResult.success) {
                        setVideoUrl('');
                        setMobileMenuOpen(false);
                        navigate('/');
                    } else {
                        setError(searchResult.error);
                    }
                } else {
                    setError(result.error);
                }
            } else {
                const result = await onSearch(videoUrl);
                if (result.success) {
                    setVideoUrl('');
                    setMobileMenuOpen(false);
                    navigate('/');
                } else {
                    setError(result.error);
                }
            }
        } catch (err) {
            setError('An unexpected error occurred. Please try again.');
            console.error(err);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUploadSuccess = () => {
        if (window.location.pathname === '/') {
            window.location.reload();
        } else {
            navigate('/');
        }
    };

    const renderActionButtons = () => (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Tooltip title="Upload Video">
                <IconButton color="inherit" onClick={() => setUploadModalOpen(true)} sx={{ mr: 1 }}>
                    <CloudUpload />
                </IconButton>
            </Tooltip>

            {isDownloading && (
                <>
                    <IconButton color="inherit" onClick={handleDownloadsClick}>
                        <Badge badgeContent={activeDownloads.length} color="secondary">
                            <Download />
                        </Badge>
                    </IconButton>
                    <Menu
                        anchorEl={anchorEl}
                        open={Boolean(anchorEl)}
                        onClose={handleDownloadsClose}
                        PaperProps={{
                            elevation: 0,
                            sx: {
                                overflow: 'visible',
                                filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                                mt: 1.5,
                                '& .MuiAvatar-root': {
                                    width: 32,
                                    height: 32,
                                    ml: -0.5,
                                    mr: 1,
                                },
                                '&:before': {
                                    content: '""',
                                    display: 'block',
                                    position: 'absolute',
                                    top: 0,
                                    right: 14,
                                    width: 10,
                                    height: 10,
                                    bgcolor: 'background.paper',
                                    transform: 'translateY(-50%) rotate(45deg)',
                                    zIndex: 0,
                                },
                            },
                        }}
                        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                    >
                        {activeDownloads.map((download) => (
                            <MenuItem key={download.id}>
                                <CircularProgress size={20} sx={{ mr: 2 }} />
                                <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                    {download.title}
                                </Typography>
                            </MenuItem>
                        ))}
                    </Menu>
                </>
            )}
            <IconButton sx={{ ml: 1 }} onClick={toggleTheme} color="inherit">
                {currentThemeMode === 'dark' ? <Brightness7 /> : <Brightness4 />}
            </IconButton>

            <Tooltip title="Manage">
                <IconButton
                    color="inherit"
                    onClick={handleManageClick}
                    sx={{ ml: 1 }}
                >
                    <Settings />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={manageAnchorEl}
                open={Boolean(manageAnchorEl)}
                onClose={handleManageClose}
                PaperProps={{
                    elevation: 0,
                    sx: {
                        overflow: 'visible',
                        filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                        mt: 1.5,
                        '&:before': {
                            content: '""',
                            display: 'block',
                            position: 'absolute',
                            top: 0,
                            right: 14,
                            width: 10,
                            height: 10,
                            bgcolor: 'background.paper',
                            transform: 'translateY(-50%) rotate(45deg)',
                            zIndex: 0,
                        },
                    },
                }}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
                <MenuItem onClick={() => { handleManageClose(); navigate('/manage'); }}>
                    <VideoLibrary sx={{ mr: 2 }} /> Manage Content
                </MenuItem>
                <MenuItem onClick={() => { handleManageClose(); navigate('/settings'); }}>
                    <Settings sx={{ mr: 2 }} /> Settings
                </MenuItem>
            </Menu>
        </Box>
    );

    const renderSearchInput = () => (
        <Box component="form" onSubmit={handleSubmit} sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', width: '100%' }}>
            <TextField
                fullWidth
                variant="outlined"
                placeholder="Enter YouTube/Bilibili URL or search term"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                disabled={isSubmitting}
                error={!!error}
                helperText={error}
                size="small"
                InputProps={{
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
                }}
            />
        </Box>
    );

    return (
        <AppBar position="sticky" color="default" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
            <Toolbar sx={{ flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', py: isMobile ? 1 : 0 }}>
                {/* Top Bar for Mobile / Main Bar for Desktop */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: isMobile ? '100%' : 'auto', flexGrow: isMobile ? 0 : 0, mr: isMobile ? 0 : 2 }}>
                    <Link to="/" onClick={onResetSearch} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', color: 'inherit' }}>
                        <img src={logo} alt="MyTube Logo" height={40} />
                        <Typography variant="h5" sx={{ ml: 1, fontWeight: 'bold' }}>
                            MyTube
                        </Typography>
                    </Link>

                    {isMobile && (
                        <IconButton onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                            <MenuIcon />
                        </IconButton>
                    )}
                </Box>

                {/* Desktop Layout */}
                {!isMobile && (
                    <>
                        <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', maxWidth: 800, mx: 'auto' }}>
                            {renderSearchInput()}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', ml: 2 }}>
                            {renderActionButtons()}
                        </Box>
                    </>
                )}

                {/* Mobile Dropdown Layout */}
                {isMobile && (
                    <Collapse in={mobileMenuOpen} sx={{ width: '100%' }}>
                        <Box sx={{ maxHeight: '80vh', overflowY: 'auto' }}>
                            <Stack spacing={2} sx={{ py: 2 }}>
                                {/* Row 1: Search Input */}
                                <Box>
                                    {renderSearchInput()}
                                </Box>
                                {/* Row 2: Action Buttons */}
                                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                                    {renderActionButtons()}
                                </Box>

                                {/* Mobile Navigation Items */}
                                <Box sx={{ mt: 2 }}>
                                    <Collections
                                        collections={collections}
                                        onItemClick={() => setMobileMenuOpen(false)}
                                    />
                                    <Box sx={{ mt: 2 }}>
                                        <AuthorsList
                                            videos={videos}
                                            onItemClick={() => setMobileMenuOpen(false)}
                                        />
                                    </Box>
                                    <Box sx={{ mt: 3, textAlign: 'center', mb: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        <Button
                                            component={Link}
                                            to="/manage"
                                            variant="outlined"
                                            fullWidth
                                            onClick={() => setMobileMenuOpen(false)}
                                            startIcon={<VideoLibrary />}
                                        >
                                            Manage Videos
                                        </Button>
                                        <Button
                                            component={Link}
                                            to="/settings"
                                            variant="outlined"
                                            fullWidth
                                            onClick={() => setMobileMenuOpen(false)}
                                            startIcon={<Settings />}
                                        >
                                            Settings
                                        </Button>
                                    </Box>
                                </Box>
                            </Stack>
                        </Box>
                    </Collapse>
                )}
            </Toolbar>

            <UploadModal
                open={uploadModalOpen}
                onClose={() => setUploadModalOpen(false)}
                onUploadSuccess={handleUploadSuccess}
            />
        </AppBar>
    );
};

export default Header;
