import {
    Box,
    Button,
    Collapse,
    Link,
    TextField,
    Typography
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface YtDlpSettingsProps {
    config: string;
    onChange: (config: string) => void;
}

// Default yt-dlp configuration
// Reference: https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#configuration
const DEFAULT_CONFIG = `# yt-dlp Configuration File
# Lines starting with # are comments
# Remove the # at the beginning of a line to enable an option
# For full documentation: https://github.com/yt-dlp/yt-dlp#configuration

# ═══════════════════════════════════════════════════════════════════════════════
# VIDEO FORMAT & RESOLUTION (Recommended: Use -S for resolution limits)
# ═══════════════════════════════════════════════════════════════════════════════

# RECOMMENDED: Use -S (format sort) for reliable resolution limits
# -S sorts formats by preference and is more reliable than -f filters

# Limit to 2160p maximum
# -S res:2160

# Limit to 1080p maximum (RECOMMENDED)
# -S res:1080

# Limit to 720p maximum
# -S res:720

# Limit to 480p maximum (for slower connections or storage savings)
# -S res:480

# Limit to 360p maximum (minimum quality)
# -S res:360

# Prefer H.264 codec with 1080p limit (Safari/iOS compatible)
# -S res:1080,vcodec:h264

# Force H.264 codec only (required for Safari/iOS playback)
# -S vcodec:h264

# ═══════════════════════════════════════════════════════════════════════════════
# FORMAT SELECTION (Alternative to -S, less reliable with some sources)
# ═══════════════════════════════════════════════════════════════════════════════

# Note: -f filters may not work reliably with all video sources
# Use -S above for more consistent results

# Download best quality (default behavior)
# -f bestvideo*+bestaudio/best

# Limit to 1080p maximum using filter
# -f bestvideo[height<=1080]+bestaudio/best[height<=1080]

# Prefer MP4 format (better compatibility)
# -f bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best

# Prefer H.264 codec (required for Safari/iOS playback)
# -f bestvideo[vcodec^=avc1]+bestaudio/best
# -f bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[ext=mp4]/best

# Download only audio (extract audio)
# -x
# --audio-format mp3
# --audio-quality 0

# ═══════════════════════════════════════════════════════════════════════════════
# DOWNLOAD OPTIONS
# ═══════════════════════════════════════════════════════════════════════════════

# Limit download speed (e.g., 1M = 1MB/s, 500K = 500KB/s)
# -r 2M

# Number of retries for failed downloads
# -R 10

# Number of concurrent fragment downloads (for DASH/HLS)
# -N 4

# ═══════════════════════════════════════════════════════════════════════════════
# SUBTITLES
# ═══════════════════════════════════════════════════════════════════════════════

# Download subtitles
# --write-subs

# Download auto-generated subtitles
# --write-auto-subs

# Subtitle languages (comma-separated, e.g., en,zh,ja)
# --sub-langs en,zh

# Convert subtitles to specific format
# --convert-subs vtt

# ═══════════════════════════════════════════════════════════════════════════════
# NETWORK OPTIONS
# ═══════════════════════════════════════════════════════════════════════════════

# Use proxy (HTTP/HTTPS/SOCKS5)
# --proxy http://127.0.0.1:7890
# --proxy socks5://127.0.0.1:1080

# Force IPv4
# -4

# Force IPv6
# -6

# Socket timeout in seconds
# --socket-timeout 30

# ═══════════════════════════════════════════════════════════════════════════════
# WORKAROUNDS
# ═══════════════════════════════════════════════════════════════════════════════

# Sleep between requests (helps avoid rate limiting)
# --sleep-requests 1

# Sleep between downloads (seconds)
# --sleep-interval 5

# Random sleep between downloads (min-max)
# --min-sleep-interval 3
# --max-sleep-interval 10

# ═══════════════════════════════════════════════════════════════════════════════
# GEO RESTRICTION BYPASS
# ═══════════════════════════════════════════════════════════════════════════════

# Bypass geo-restriction using X-Forwarded-For header
# --xff default

# Use specific country code
# --xff US

# ═══════════════════════════════════════════════════════════════════════════════
# YOUTUBE SPECIFIC
# ═══════════════════════════════════════════════════════════════════════════════

# Use specific player client (web, android, ios, tv)
# --extractor-args youtube:player_client=android

# Skip HLS or DASH formats
# --extractor-args youtube:skip=hls
# --extractor-args youtube:skip=dash

# ═══════════════════════════════════════════════════════════════════════════════
# BILIBILI SPECIFIC
# ═══════════════════════════════════════════════════════════════════════════════

# Note: By default, MyTube prefers H.264 codec for Safari compatibility
# Bilibili may serve HEVC (H.265) which doesn't play in Safari

# Force H.264 codec (best compatibility with Safari/iOS)
# -S vcodec:h264

# Prefer H.264 with resolution limit
# -S res:1080,vcodec:h264

# ═══════════════════════════════════════════════════════════════════════════════
# AUTHENTICATION
# ═══════════════════════════════════════════════════════════════════════════════

# Use cookies from browser (chrome, firefox, edge, safari, opera, brave)
# --cookies-from-browser chrome

# Use netrc file for authentication
# --netrc

# ═══════════════════════════════════════════════════════════════════════════════
# POST-PROCESSING
# ═══════════════════════════════════════════════════════════════════════════════

# Embed thumbnail in video file
# --embed-thumbnail

# Embed subtitles in video file (for mp4, webm, mkv)
# --embed-subs

# Embed metadata
# --embed-metadata

# Keep original video after post-processing
# -k

# ═══════════════════════════════════════════════════════════════════════════════
# SPONSORBLOCK (YouTube only)
# ═══════════════════════════════════════════════════════════════════════════════

# Mark sponsor segments as chapters
# --sponsorblock-mark all

# Remove sponsor segments from video
# --sponsorblock-remove sponsor,intro,outro

`;

const YtDlpSettings: React.FC<YtDlpSettingsProps> = ({ config, onChange }) => {
    const { t } = useLanguage();
    const [isExpanded, setIsExpanded] = useState(false);
    const [localConfig, setLocalConfig] = useState(config || DEFAULT_CONFIG);

    // Sync local config when prop changes
    useEffect(() => {
        setLocalConfig(config || DEFAULT_CONFIG);
    }, [config]);

    const handleCustomize = () => {
        setIsExpanded(!isExpanded);
        if (!isExpanded) {
            // When expanding, sync local config with prop
            setLocalConfig(config || DEFAULT_CONFIG);
        }
    };

    const handleConfigChange = (value: string) => {
        setLocalConfig(value);
        onChange(value);
    };

    const handleReset = () => {
        setLocalConfig(DEFAULT_CONFIG);
        onChange(DEFAULT_CONFIG);
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, mb: 2 }}>
                <Box>
                    <Typography variant="h6" gutterBottom>
                        {t('ytDlpConfiguration') || 'yt-dlp Configuration'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('ytDlpConfigurationDescription') || 'Configure yt-dlp options. See '}
                        <Link
                            href="https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#configuration"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {t('ytDlpConfigurationDocs') || 'documentation'}
                        </Link>
                        {' '}
                        {t('ytDlpConfigurationDescriptionEnd') || 'for more information.'}
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    onClick={handleCustomize}
                >
                    {isExpanded ? (t('hide') || 'Hide') : (t('customize') || 'Customize')}
                </Button>
            </Box>

            <Collapse in={isExpanded}>
                <Box sx={{ mt: 2 }}>
                    <TextField
                        fullWidth
                        multiline
                        rows={12}
                        value={localConfig}
                        onChange={(e) => handleConfigChange(e.target.value)}
                        placeholder={DEFAULT_CONFIG}
                        sx={{
                            '& .MuiInputBase-root': {
                                fontFamily: 'monospace',
                                fontSize: '0.875rem'
                            }
                        }}
                    />
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 2, gap: 2 }}>
                        <Button
                            variant="outlined"
                            color="warning"
                            onClick={handleReset}
                        >
                            {t('reset') || 'Reset'}
                        </Button>
                    </Box>
                </Box>
            </Collapse>
        </Box>
    );
};

export default YtDlpSettings;
