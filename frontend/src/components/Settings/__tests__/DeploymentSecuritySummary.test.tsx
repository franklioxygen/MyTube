import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DeploymentSecuritySummary from '../DeploymentSecuritySummary';

// Mock language context: t echoes the key. createTranslateOrFallback then
// returns the *fallback* when the key matches, so assertions check fallbacks.
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('DeploymentSecuritySummary', () => {
    const onShowDetails = vi.fn();

    it('renders a loading alert when deploymentSecurity is undefined', () => {
        render(
            <DeploymentSecuritySummary
                deploymentSecurity={undefined}
                onShowDetails={onShowDetails}
                detailsButtonAriaLabel="Deployment Security Details"
            />
        );

        expect(screen.getByText('Deployment Security Model')).toBeInTheDocument();
        expect(screen.getByText(/Deployment security policy is loading/)).toBeInTheDocument();
    });

    it('renders the admin trust level label and description when available', () => {
        render(
            <DeploymentSecuritySummary
                deploymentSecurity={{ adminTrustLevel: 'host' }}
                onShowDetails={onShowDetails}
                detailsButtonAriaLabel="Deployment Security Details"
            />
        );

        expect(screen.getByText(/Host$/)).toBeInTheDocument();
        expect(screen.getByText('Admin is trusted with host-scoped administrative actions.')).toBeInTheDocument();
    });

    it('uses a success severity for application trust level', () => {
        render(
            <DeploymentSecuritySummary
                deploymentSecurity={{ adminTrustLevel: 'application' }}
                onShowDetails={onShowDetails}
                detailsButtonAriaLabel="Deployment Security Details"
            />
        );

        // application renders the "Application" label
        expect(screen.getByText(/Application$/)).toBeInTheDocument();
    });

    it('invokes onShowDetails when the Details button is clicked', async () => {
        const user = userEvent.setup();
        render(
            <DeploymentSecuritySummary
                deploymentSecurity={{ adminTrustLevel: 'container' }}
                onShowDetails={onShowDetails}
                detailsButtonAriaLabel="Deployment Security Details"
            />
        );

        await user.click(screen.getByRole('button', { name: 'Deployment Security Details' }));

        expect(onShowDetails).toHaveBeenCalledTimes(1);
    });
});
