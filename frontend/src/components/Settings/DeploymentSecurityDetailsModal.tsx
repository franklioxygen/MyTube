
import { Close } from '@mui/icons-material';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { createTranslateOrFallback } from '../../utils/translateOrFallback';

interface DeploymentSecurityDetailsModalProps {
    open: boolean;
    onClose: () => void;
}

const DeploymentSecurityDetailsModal: React.FC<DeploymentSecurityDetailsModalProps> = ({ open, onClose }) => {
    const { t } = useLanguage();
    const translateOrFallback = createTranslateOrFallback(t);

    // Use literal check/cross glyphs so the capability matrix reads as ✓/✗ at a glance.
    const allowedLabel = '\u2713';
    const blockedLabel = '\u2715';
    const codeBlockSx = {
        mt: 1,
        mb: 0,
        p: 1.5,
        borderRadius: 1,
        bgcolor: 'action.hover',
        overflowX: 'auto',
        fontFamily: 'monospace',
        fontSize: '0.875rem',
        lineHeight: 1.5,
    };

    const capabilityRows = [
        {
            capability: translateOrFallback(
                'deploymentSecurityStandardAppManagement',
                'Standard app management (videos, collections, tags, login, backups)'
            ),
            application: allowedLabel,
            container: allowedLabel,
            host: allowedLabel,
        },
        {
            capability: translateOrFallback(
                'deploymentSecurityTaskHooksCapability',
                'Task hooks upload/delete/execute'
            ),
            application: blockedLabel,
            container: allowedLabel,
            host: allowedLabel,
        },
        {
            capability: translateOrFallback(
                'deploymentSecurityRawYtDlpConfigTextArea',
                'Raw yt-dlp config text area'
            ),
            application: blockedLabel,
            container: allowedLabel,
            host: allowedLabel,
        },
        {
            capability: translateOrFallback(
                'deploymentSecurityFullRawYtDlpFlagPassthrough',
                'Full raw yt-dlp flag passthrough'
            ),
            application: blockedLabel,
            container: allowedLabel,
            host: allowedLabel,
        },
        {
            capability: translateOrFallback(
                'deploymentSecurityMountDirectorySettingsPersistence',
                'Mount directory settings persistence'
            ),
            application: blockedLabel,
            container: blockedLabel,
            host: allowedLabel,
        },
        {
            capability: translateOrFallback(
                'deploymentSecurityScanMountDirectories',
                'Scan files from configured mount directories'
            ),
            application: blockedLabel,
            container: blockedLabel,
            host: allowedLabel,
        },
        {
            capability: translateOrFallback(
                'deploymentSecurityFutureHostPathMaintenanceFeatures',
                'Future host-path maintenance features'
            ),
            application: blockedLabel,
            container: blockedLabel,
            host: allowedLabel,
        },
    ];

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                    {translateOrFallback('deploymentSecurityDetailsTitle', 'Deployment Security Details')}
                </Typography>
                <IconButton
                    aria-label="close"
                    onClick={onClose}
                    sx={{ color: (muiTheme) => muiTheme.palette.grey[500] }}
                >
                    <Close />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>
                                    {translateOrFallback('deploymentSecurityCapabilityFeature', 'Capability / Feature')}
                                </TableCell>
                                <TableCell>{translateOrFallback('adminTrustLevelApplication', 'Application')}</TableCell>
                                <TableCell>{translateOrFallback('adminTrustLevelContainer', 'Container')}</TableCell>
                                <TableCell>{translateOrFallback('adminTrustLevelHost', 'Host')}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {capabilityRows.map((row) => (
                                <TableRow key={typeof row.capability === 'string' ? row.capability : String(row.capability)}>
                                    <TableCell>{row.capability}</TableCell>
                                    <TableCell>{row.application}</TableCell>
                                    <TableCell>{row.container}</TableCell>
                                    <TableCell>{row.host}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
                <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {translateOrFallback('deploymentSecurityConfigurationTitle', 'How to configure')}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                            {translateOrFallback(
                                'deploymentSecurityConfigurationValuesNote',
                                'Use MYTUBE_ADMIN_TRUST_LEVEL with application, container, or host. Missing or invalid values fall back to container.'
                            )}
                        </Typography>
                    </Box>
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {translateOrFallback('deploymentSecurityDockerConfigTitle', 'Docker / Docker Compose')}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                            {translateOrFallback(
                                'deploymentSecurityDockerConfigDescription',
                                'Set MYTUBE_ADMIN_TRUST_LEVEL in the service environment. Replace application with container or host as needed.'
                            )}
                        </Typography>
                        <Box component="pre" sx={codeBlockSx}>
{`environment:
  - MYTUBE_ADMIN_TRUST_LEVEL=application`}
                        </Box>
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            {translateOrFallback(
                                'deploymentSecurityDockerPermissionsNote',
                                'If you are upgrading a bind-mounted installation created before v1.9.0, make sure the host-side uploads and data folders are writable by uid/gid 1000 (`node`). This also fixes root-owned uploads/images-small directories that can cause thumbnail generation or scans to fail with EACCES.'
                            )}
                        </Typography>
                        <Box component="pre" sx={codeBlockSx}>
{`chown -R 1000:1000 /path/to/mytube/uploads /path/to/mytube/data`}
                        </Box>
                    </Box>
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {translateOrFallback('deploymentSecurityLocalConfigTitle', 'Local source run')}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                            {translateOrFallback(
                                'deploymentSecurityLocalConfigDescription',
                                'Export MYTUBE_ADMIN_TRUST_LEVEL before starting MyTube, or pass it inline when running npm run dev.'
                            )}
                        </Typography>
                        <Box component="pre" sx={codeBlockSx}>
{`MYTUBE_ADMIN_TRUST_LEVEL=application npm run dev`}
                        </Box>
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            {translateOrFallback(
                                'deploymentSecurityLocalEnvFileNote',
                                'You can also put the same line in backend/.env.'
                            )}
                        </Typography>
                        <Box component="pre" sx={codeBlockSx}>
{`# backend/.env
MYTUBE_ADMIN_TRUST_LEVEL=application`}
                        </Box>
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} variant="outlined">
                    {translateOrFallback('deploymentSecurityClose', 'Close')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DeploymentSecurityDetailsModal;
