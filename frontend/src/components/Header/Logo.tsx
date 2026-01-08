import { Box, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import logo from '../../assets/logo.svg';
import { useCloudflareStatus } from '../../hooks/useCloudflareStatus';
import { useSettings } from '../../hooks/useSettings';

interface LogoProps {
    websiteName: string;
    onResetSearch?: () => void;
}

const Logo: React.FC<LogoProps> = ({ websiteName, onResetSearch }) => {
    // Only check Cloudflare status if it's enabled in settings
    const { data: settings } = useSettings();
    const cloudflaredEnabled = settings?.cloudflaredTunnelEnabled ?? false;
    const { data: cloudflaredStatus } = useCloudflareStatus(cloudflaredEnabled);

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

