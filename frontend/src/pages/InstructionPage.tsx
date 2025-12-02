import { Box, Container, Divider, List, ListItem, ListItemText, Paper, Typography } from '@mui/material';
import React from 'react';
import Disclaimer from '../components/Disclaimer';
import { useLanguage } from '../contexts/LanguageContext';

const InstructionPage: React.FC = () => {
    const { t } = useLanguage();

    const renderInstructions = () => (
        <Paper elevation={0} sx={{ p: 3, bgcolor: 'transparent' }}>
            {/* Section 1 */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {t('instructionSection1Title')}
                </Typography>
                <Typography variant="body1" paragraph color="text.secondary">
                    {t('instructionSection1Desc')}
                </Typography>

                <Box sx={{ ml: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                        {t('instructionSection1Sub1')}
                    </Typography>
                    <List dense>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection1Item1Label')}</b> {t('instructionSection1Item1Text')}</>}
                            />
                        </ListItem>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection1Item2Label')}</b> {t('instructionSection1Item2Text')}</>}
                            />
                        </ListItem>
                    </List>

                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                        {t('instructionSection1Sub2')}
                    </Typography>
                    <List dense>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection1Item3Label')}</b> {t('instructionSection1Item3Text')}</>}
                            />
                        </ListItem>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection1Item4Label')}</b> {t('instructionSection1Item4Text')}</>}
                            />
                        </ListItem>
                    </List>

                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                        {t('instructionSection1Sub3')}
                    </Typography>
                    <List dense>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection1Item5Label')}</b> {t('instructionSection1Item5Text')}</>}
                            />
                        </ListItem>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection1Item6Label')}</b> {t('instructionSection1Item6Text')}</>}
                            />
                        </ListItem>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection1Item7Label')}</b> {t('instructionSection1Item7Text')}</>}
                            />
                        </ListItem>
                    </List>
                </Box>
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Section 2 */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {t('instructionSection2Title')}
                </Typography>
                <Typography variant="body1" paragraph color="text.secondary">
                    {t('instructionSection2Desc')}
                </Typography>

                <Box sx={{ ml: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                        {t('instructionSection2Sub1')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 1, ml: 2 }}>
                        {t('instructionSection2Text1')}
                    </Typography>

                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                        {t('instructionSection2Sub2')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 1, ml: 2 }}>
                        {t('instructionSection2Text2')}
                    </Typography>
                </Box>
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Section 3 */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {t('instructionSection3Title')}
                </Typography>
                <Typography variant="body1" paragraph color="text.secondary">
                    {t('instructionSection3Desc')}
                </Typography>

                <Box sx={{ ml: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                        {t('instructionSection3Sub1')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 1, ml: 2 }}>
                        {t('instructionSection3Text1')}
                    </Typography>

                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                        {t('instructionSection3Sub2')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 1, ml: 2 }}>
                        {t('instructionSection3Text2')}
                    </Typography>

                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                        {t('instructionSection3Sub3')}
                    </Typography>
                    <List dense>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection3Item1Label')}</b> {t('instructionSection3Item1Text')}</>}
                            />
                        </ListItem>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection3Item2Label')}</b> {t('instructionSection3Item2Text')}</>}
                            />
                        </ListItem>
                    </List>

                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                        {t('instructionSection3Sub4')}
                    </Typography>
                    <List dense>
                        <ListItem>
                            <ListItemText
                                primary={<><b>{t('instructionSection3Item3Label')}</b> {t('instructionSection3Item3Text')}</>}
                            />
                        </ListItem>
                    </List>
                </Box>
            </Box>

            <Divider sx={{ my: 3 }} />

            <Disclaimer />
        </Paper>
    );

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 'bold' }}>
                    {t('instruction')}
                </Typography>
            </Box>

            <Box>
                {renderInstructions()}
            </Box>
        </Container>
    );
};

export default InstructionPage;
