import {
    Alert,
    Button,
    Typography,
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { AdminTrustLevel } from '../../types';
import { createTranslateOrFallback } from '../../utils/translateOrFallback';

interface DeploymentSecuritySummaryProps {
    deploymentSecurity?: {
        adminTrustLevel?: AdminTrustLevel;
    };
    onShowDetails: () => void;
    detailsButtonAriaLabel: string;
}

const DeploymentSecuritySummary: React.FC<DeploymentSecuritySummaryProps> = ({
    deploymentSecurity,
    onShowDetails,
    detailsButtonAriaLabel,
}) => {
    const { t } = useLanguage();
    const translateOrFallback = createTranslateOrFallback(t);
    const adminTrustLevel = deploymentSecurity?.adminTrustLevel;

    const renderDetailsLink = () => (
        <Button
            variant="text"
            size="small"
            onClick={onShowDetails}
            aria-label={detailsButtonAriaLabel}
            sx={{ minWidth: 0, p: 0, ml: 0.5, verticalAlign: 'baseline', textTransform: 'none' }}
        >
            {translateOrFallback('deploymentSecurityDetails', 'Details')}
        </Button>
    );

    if (!deploymentSecurity || !adminTrustLevel) {
        return (
            <Alert severity="info">
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    {translateOrFallback('deploymentSecurityTitle', 'Deployment Security Model')}
                </Typography>
                <Typography variant="body2">
                    {translateOrFallback(
                        'deploymentSecurityLoading',
                        'Deployment security policy is loading. Restricted features remain hidden until the policy is available.'
                    )}
                    {renderDetailsLink()}
                </Typography>
            </Alert>
        );
    }

    const levelLabels: Record<AdminTrustLevel, string> = {
        application: translateOrFallback('adminTrustLevelApplication', 'Application'),
        container: translateOrFallback('adminTrustLevelContainer', 'Container'),
        host: translateOrFallback('adminTrustLevelHost', 'Host'),
    };
    const levelDescriptions: Record<AdminTrustLevel, string> = {
        application: translateOrFallback(
            'adminTrustLevelApplicationDescription',
            'Admin is trusted at the application layer only.'
        ),
        container: translateOrFallback(
            'adminTrustLevelContainerDescription',
            'Admin is trusted with backend/container-process-level actions.'
        ),
        host: translateOrFallback(
            'adminTrustLevelHostDescription',
            'Admin is trusted with host-scoped administrative actions.'
        ),
    };

    return (
        <Alert severity={adminTrustLevel === 'application' ? 'success' : 'info'}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {translateOrFallback('deploymentSecurityTitle', 'Deployment Security Model')}
            </Typography>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
                {translateOrFallback('adminTrustLevelLabel', 'Admin Trust Level')}: {levelLabels[adminTrustLevel]}
            </Typography>
            <Typography variant="body2">
                {levelDescriptions[adminTrustLevel]}
                {renderDetailsLink()}
            </Typography>
        </Alert>
    );
};

export default DeploymentSecuritySummary;
