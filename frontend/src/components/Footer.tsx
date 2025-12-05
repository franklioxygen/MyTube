import { GitHub } from '@mui/icons-material';
import { Box, Container, Link, Typography, useTheme } from '@mui/material';

const Footer = () => {
    const theme = useTheme();


    return (
        <Box
            component="footer"
            sx={{
                py: 3,
                px: 2,
                mt: 'auto',
                backgroundColor: theme.palette.mode === 'light'
                    ? theme.palette.grey[200]
                    : theme.palette.grey[900],
                borderTop: `1px solid ${theme.palette.divider}`
            }}
        >
            <Container maxWidth="lg">
                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>

                    <Box sx={{ display: 'flex', alignItems: 'center', mt: { xs: 1, sm: 0 } }}>
                        <Link
                            href="https://github.com/franklioxygen/MyTube"
                            target="_blank"
                            rel="noopener noreferrer"
                            color="inherit"
                            underline="none"
                            sx={{ display: 'flex', alignItems: 'center' }}
                        >
                            <GitHub sx={{ fontSize: 16, mr: 0.5 }} />
                            <Typography variant="body2" color="text.secondary" sx={{ mr: 2 }}>
                                MyTube
                            </Typography>
                        </Link>
                        <Typography variant="body2" color="text.secondary">
                            v{import.meta.env.VITE_APP_VERSION}
                        </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Created by franklioxygen
                    </Typography>
                </Box>
            </Container>
        </Box>
    );
};

export default Footer;
