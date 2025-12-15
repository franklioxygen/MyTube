import { GitHub } from '@mui/icons-material';
import { Box, Container, Link, Typography, useTheme } from '@mui/material';

const Footer = () => {
    const theme = useTheme();


    return (
        <Box
            component="footer"
            sx={{
                py: 2,
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
                            color="text.secondary"
                            underline="none"
                            variant="caption"
                            sx={{ display: 'flex', alignItems: 'center', mr: 2 }}
                        >
                            <GitHub sx={{ fontSize: 'inherit', mr: 0.5 }} />
                            MyTube
                        </Link>
                        <Typography variant="caption" color="text.secondary">
                            v{import.meta.env.VITE_APP_VERSION}
                        </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                        Created by franklioxygen
                    </Typography>
                </Box>
            </Container>
        </Box>
    );
};

export default Footer;
