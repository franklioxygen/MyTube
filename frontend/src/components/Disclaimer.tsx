import { Box, Paper, Typography } from '@mui/material';
import React from 'react';
import { modeColors } from '../theme/colors';
import { en } from '../utils/locales/en';

const Disclaimer: React.FC = () => {
    return (
        <Box sx={{ mt: 4, mb: 2 }}>
            <Paper
                elevation={0}
                sx={{
                    p: 3,
                    bgcolor: (theme) => modeColors(theme.palette.mode).cardBackground,
                    border: '1px solid',
                    borderColor: (theme) => modeColors(theme.palette.mode).cardBorder,
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
