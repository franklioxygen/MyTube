import { ExpandLess, ExpandMore, HelpOutline, InfoOutlined } from '@mui/icons-material';
import { Alert, Box, Button, Collapse, Divider, Link, Typography } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import FederationPeers from './FederationPeers';
import FederationTokens from './FederationTokens';

const GUIDE_URL = 'https://github.com/franklioxygen/MyTube/blob/master/documents';

/** Multi-instance library (issue #354): owner-only settings. */
const FederationSettings: React.FC = () => {
    const { t, language } = useLanguage();
    const [showHelp, setShowHelp] = useState(false);
    // The full guide exists in Chinese and English.
    const guideUrl = `${GUIDE_URL}/${language === 'zh' ? 'zh' : 'en'}/multi-instance-library.md`;

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="h6">{t('federationTitle')}</Typography>
                <Button
                    size="small"
                    startIcon={<HelpOutline />}
                    endIcon={showHelp ? <ExpandLess /> : <ExpandMore />}
                    onClick={() => setShowHelp((shown) => !shown)}
                    aria-expanded={showHelp}
                    aria-controls="federation-help"
                >
                    {t('federationHelpToggle')}
                </Button>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('federationDescription')}
            </Typography>
            <Collapse in={showHelp} unmountOnExit>
                {/* Steps name the real controls through their own translations. */}
                <Alert id="federation-help" severity="info" icon={<InfoOutlined />} sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                        {t('federationHelpStepsTitle')}
                    </Typography>
                    <Typography variant="body2" component="ol" sx={{ pl: 2.5, mt: 0, mb: 1.5 }}>
                        <li>
                            {t('federationHelpStep1', {
                                action: t('federationCreateToken'),
                                section: t('federationTokensTitle'),
                            })}
                        </li>
                        <li>
                            {t('federationHelpStep2', {
                                action: t('federationAddPeer'),
                                section: t('federationPeersTitle'),
                            })}
                        </li>
                        <li>{t('federationHelpStep3')}</li>
                    </Typography>
                    <Typography variant="subtitle2" gutterBottom>
                        {t('federationHelpNotesTitle')}
                    </Typography>
                    <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0, mb: 1 }}>
                        <li>{t('federationHelpNoteOwner', { setting: t('enableLogin') })}</li>
                        <li>{t('federationHelpNoteNetwork')}</li>
                        <li>{t('federationHelpNoteBackup')}</li>
                    </Typography>
                    <Link href={guideUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                        {t('federationHelpGuide')}
                    </Link>
                </Alert>
            </Collapse>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <FederationTokens />
                <Divider />
                <FederationPeers />
            </Box>
        </Box>
    );
};

export default FederationSettings;
