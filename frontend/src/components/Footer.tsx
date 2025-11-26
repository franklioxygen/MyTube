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
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'center', alignItems: 'center' }}>

                    <Box sx={{ display: 'flex', alignItems: 'center', mt: { xs: 1, sm: 0 } }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mr: 2 }}>
                            Created by franklioxygen
                        </Typography>
                        <Link
                            href="https://github.com/franklioxygen/MyTube"
                            target="_blank"
                            rel="noopener noreferrer"
                            color="inherit"
                            sx={{ display: 'flex', alignItems: 'center' }}
                        >
                            <GitHub fontSize="small" sx={{ mr: 0.5 }} />
                        </Link>
                    </Box>
                </Box>
            </Container>
        </Box>
    );
};

export default Footer;
