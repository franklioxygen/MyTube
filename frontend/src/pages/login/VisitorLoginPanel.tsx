import { Box, Button } from '@mui/material';
import type { FormEvent } from 'react';
import type { TranslateFn } from '../../utils/translateOrFallback';
import { PasswordField } from './PasswordField';

interface VisitorLoginPanelProps {
    activeTab: number;
    onPasswordChange: (password: string) => void;
    onPasswordSubmit: (password: string) => void;
    onTogglePasswordVisibility: () => void;
    showPassword: boolean;
    t: TranslateFn;
    visitorLoginPending: boolean;
    visitorPassword: string;
    waitTime: number;
}

export const VisitorLoginPanel: React.FC<VisitorLoginPanelProps> = ({
    activeTab,
    onPasswordChange,
    onPasswordSubmit,
    onTogglePasswordVisibility,
    showPassword,
    t,
    visitorLoginPending,
    visitorPassword,
    waitTime,
}) => {
    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (waitTime > 0) {
            return;
        }
        onPasswordSubmit(visitorPassword);
    };

    const passwordDisabled = waitTime > 0 || visitorLoginPending;

    return (
        <div
            role="tabpanel"
            hidden={activeTab !== 1}
            id="login-tabpanel-1"
            aria-labelledby="login-tab-1"
        >
            {activeTab === 1 && (
                <Box component="form" onSubmit={handleSubmit} noValidate>
                    <PasswordField
                        name="visitorPassword"
                        label={t('visitorPassword') || 'Visitor Password'}
                        id="visitorPassword"
                        value={visitorPassword}
                        onChange={(event) => {
                            onPasswordChange(event.target.value);
                        }}
                        autoFocus
                        disabled={passwordDisabled}
                        showPassword={showPassword}
                        onToggleVisibility={onTogglePasswordVisibility}
                        t={t}
                    />
                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        sx={{ mt: 3, mb: 2 }}
                        disabled={passwordDisabled}
                    >
                        {visitorLoginPending ? (t('verifying') || 'Verifying...') : (t('visitorSignIn') || 'Visitor Sign In')}
                    </Button>
                </Box>
            )}
        </div>
    );
};
