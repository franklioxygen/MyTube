import { Box, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import logo from '../../assets/logo.svg';

interface LogoProps {
    websiteName: string;
    onResetSearch?: () => void;
}

const Logo: React.FC<LogoProps> = ({ websiteName, onResetSearch }) => {
    return (
        <Link to="/" onClick={onResetSearch} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', color: 'inherit' }}>
            <img src={logo} alt="MyTube Logo" height={40} />
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

