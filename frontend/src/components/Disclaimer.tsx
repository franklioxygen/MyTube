import { Box, Paper, Typography } from '@mui/material';
import React from 'react';
import { en } from '../utils/locales/en';

const Disclaimer: React.FC = () => {
    return (
        <Box sx={{ mt: 4, mb: 2 }}>
            <Paper
                elevation={0}
                sx={{
                    p: 3,
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(30, 30, 30, 0.6)' : 'background.paper',
                    border: '1px solid',
                    borderColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                    borderRadius: 4,
                    backdropFilter: 'blur(10px)'
                }}
            >
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1, color: 'primary.main' }}>
                    {en.disclaimerTitle}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
                    {en.disclaimerText}
                </Typography>
            </Paper>
        </Box>
    );
};

export default Disclaimer;
