import { LockOutlined } from '@mui/icons-material';
import {
    Alert,
    Box,
    Tab,
    Tabs,
    Typography,
} from '@mui/material';
import type { TranslateFn } from '../../utils/translateOrFallback';
import { formatWaitTime } from './loginUtils';
import { AdminLoginPanel } from './AdminLoginPanel';
import { LoginBrand } from './LoginBrand';
import { VisitorLoginPanel } from './VisitorLoginPanel';

interface LoginFormProps {
    activeTab: number;
    adminLoginPending: boolean;
    onAdminPasswordSubmit: (password: string) => void;
    onPasskeyLogin: () => void;
    onPasswordChange: (password: string) => void;
    onResetPassword: () => void;
    onShowPasswordChange: (show: boolean) => void;
    onShowVisitorPasswordChange: (show: boolean) => void;
    onTabChange: (tab: number) => void;
    onVisitorPasswordChange: (password: string) => void;
    onVisitorPasswordSubmit: (password: string) => void;
    passkeyLoginPending: boolean;
    passkeysExist: boolean;
    password: string;
    passwordLoginAllowed: boolean;
    showPassword: boolean;
    showVisitorPassword: boolean;
    showVisitorTab: boolean;
    t: TranslateFn;
    visitorLoginPending: boolean;
    visitorPassword: string;
    waitTime: number;
    websiteName: string;
}

export const LoginForm: React.FC<LoginFormProps> = ({
    activeTab,
    adminLoginPending,
    onAdminPasswordSubmit,
    onPasskeyLogin,
    onPasswordChange,
    onResetPassword,
    onShowPasswordChange,
    onShowVisitorPasswordChange,
    onTabChange,
    onVisitorPasswordChange,
    onVisitorPasswordSubmit,
    passkeyLoginPending,
    passkeysExist,
    password,
    passwordLoginAllowed,
    showPassword,
    showVisitorPassword,
    showVisitorTab,
    t,
    visitorLoginPending,
    visitorPassword,
    waitTime,
    websiteName,
}) => (
    <>
        <LoginBrand websiteName={websiteName} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <LockOutlined sx={{ color: 'text.primary' }} />
            <Typography component="h1" variant="h5">
                {t('signIn')}
            </Typography>
        </Box>
        <Box sx={{ mt: 1, width: '100%' }}>
            {showVisitorTab && (
                <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                    <Tabs
                        value={activeTab}
                        onChange={(_, newValue: number) => {
                            onTabChange(newValue);
                        }}
                        aria-label="login tabs"
                        variant="fullWidth"
                    >
                        <Tab label={t('admin') || 'Admin'} id="login-tab-0" aria-controls="login-tabpanel-0" />
                        <Tab label={t('visitorUser') || 'Visitor'} id="login-tab-1" aria-controls="login-tabpanel-1" />
                    </Tabs>
                </Box>
            )}

            <AdminLoginPanel
                activeTab={activeTab}
                adminLoginPending={adminLoginPending}
                onPasskeyLogin={onPasskeyLogin}
                onPasswordChange={onPasswordChange}
                onPasswordSubmit={onAdminPasswordSubmit}
                onResetPassword={onResetPassword}
                onTogglePasswordVisibility={() => {
                    onShowPasswordChange(!showPassword);
                }}
                passkeyLoginPending={passkeyLoginPending}
                passkeysExist={passkeysExist}
                password={password}
                passwordLoginAllowed={passwordLoginAllowed}
                showPassword={showPassword}
                showVisitorTab={showVisitorTab}
                t={t}
                waitTime={waitTime}
            />

            {showVisitorTab && (
                <VisitorLoginPanel
                    activeTab={activeTab}
                    onPasswordChange={onVisitorPasswordChange}
                    onPasswordSubmit={onVisitorPasswordSubmit}
                    onTogglePasswordVisibility={() => {
                        onShowVisitorPasswordChange(!showVisitorPassword);
                    }}
                    showPassword={showVisitorPassword}
                    t={t}
                    visitorLoginPending={visitorLoginPending}
                    visitorPassword={visitorPassword}
                    waitTime={waitTime}
                />
            )}

            <Box sx={{ minHeight: waitTime > 0 ? 'auto' : 0, mt: 2 }}>
                {waitTime > 0 && (
                    <Alert severity="warning" sx={{ width: '100%' }}>
                        {t('waitTimeMessage').replace('{time}', formatWaitTime(waitTime))}
                    </Alert>
                )}
            </Box>
        </Box>
    </>
);
