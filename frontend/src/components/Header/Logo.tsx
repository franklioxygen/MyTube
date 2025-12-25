import { Box, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import logo from '../../assets/logo.svg';
import { useCloudflareStatus } from '../../hooks/useCloudflareStatus';

interface LogoProps {
    websiteName: string;
    onResetSearch?: () => void;
}

const Logo: React.FC<LogoProps> = ({ websiteName, onResetSearch }) => {
    // Only check status if we think it might be enabled, or just check always (it handles enabled=false internally somewhat, but better to query only if needed)
    // Since we don't have easy access to settings here without adding another context, we'll check status always for now or ideally use a context.
    // However, the hook defaults to enabled=true. Let's rely on the hook handling null if not running.
    // Actually, checking status constantly might be overkill if disabled. But without global settings context readily available in Logo without refactor, we'll assume we want to check.
    // Better strategy: The user explicitly asked for "When cloudflare Status is Running".
    const { data: cloudflaredStatus } = useCloudflareStatus(true);

    return (
        <Link to="/" onClick={onResetSearch} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', color: 'inherit' }}>
            <Box sx={{ position: 'relative' }}>
                <img src={logo} alt="MyTube Logo" height={40} />
                {cloudflaredStatus?.isRunning && (
                    <Box
                        sx={{
                            position: 'absolute',
                            top: 2,
                            right: -2,
                            width: 8,
                            height: 8,
                            bgcolor: '#4caf50', // Green
                            borderRadius: '50%',
                            boxShadow: '0 0 4px #4caf50'
                        }}
                    />
                )}
            </Box>
            <Box sx={{ ml: 1, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="h5" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
                    {websiteName}
                </Typography>
                {websiteName !== 'MyTube' && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', lineHeight: 1 }}>
                        Powered by MyTube
                    </Typography>
                )}
            </Box>
        </Link>
    );
};

export default Logo;

