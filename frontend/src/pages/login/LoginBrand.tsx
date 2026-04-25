import { Box, Typography } from '@mui/material';
import logo from '../../assets/logo.svg';

interface LoginBrandProps {
    websiteName: string;
}

export const LoginBrand: React.FC<LoginBrandProps> = ({ websiteName }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <img src={logo} alt="Logo" height={48} />
        <Box sx={{ ml: 1.5, display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h4" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
                {websiteName}
            </Typography>
            {websiteName !== 'MyTube' && (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', lineHeight: 1.2, mt: 0.25 }}>
                    Powered by MyTube
                </Typography>
            )}
        </Box>
    </Box>
);
