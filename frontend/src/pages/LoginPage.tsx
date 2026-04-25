import { Box, Container } from '@mui/material';
import React, { useEffect, useState } from 'react';
import AlertModal from '../components/AlertModal';
import VersionInfo from '../components/VersionInfo';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { ConnectionStateView } from './login/ConnectionStateView';
import { LoginForm } from './login/LoginForm';
import { useLoginActions } from './login/useLoginActions';
import { useLoginStatus } from './login/useLoginStatus';

const LoginPage: React.FC = () => {
    const [visitorPassword, setVisitorPassword] = useState('');
    const [showVisitorPassword, setShowVisitorPassword] = useState(false);
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [waitTime, setWaitTime] = useState(0);
    const [activeTab, setActiveTab] = useState(0);
    const [alertOpen, setAlertOpen] = useState(false);
    const [alertTitle, setAlertTitle] = useState('');
    const [alertMessage, setAlertMessage] = useState('');
    const [websiteName, setWebsiteName] = useState('MyTube');
    const { t } = useLanguage();
    const { login } = useAuth();
    const {
        statusData,
        passwordEnabledData,
        passwordLoginAllowed,
        showVisitorTab,
        passkeysExist,
        isCheckingConnection,
        isConnectionError,
        retryConnection,
    } = useLoginStatus();

    const showAlert = (title: string, message: string) => {
        setAlertTitle(title);
        setAlertMessage(message);
        setAlertOpen(true);
    };

    const {
        adminLoginMutation,
        visitorLoginMutation,
        passkeyLoginMutation,
        handlePasskeyLogin,
        showResetInstructions,
    } = useLoginActions({
        login,
        setWaitTime,
        showAlert,
        t,
    });

    useEffect(() => {
        if (passwordEnabledData?.websiteName) {
            setWebsiteName(passwordEnabledData.websiteName);
        }
    }, [passwordEnabledData]);

    useEffect(() => {
        if (statusData?.loginRequired === false) {
            login();
        }
    }, [statusData, login]);

    useEffect(() => {
        if (waitTime <= 0) {
            return;
        }

        const interval = setInterval(() => {
            setWaitTime((prev) => {
                const newTime = prev - 1000;
                return newTime > 0 ? newTime : 0;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [waitTime]);

    const connectionState = isCheckingConnection
        ? 'loading'
        : isConnectionError
            ? 'error'
            : null;

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.default',
            }}
        >
            <Container component="main" maxWidth="xs" sx={{ flex: 1 }}>
                <Box
                    sx={{
                        marginTop: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                    }}
                >
                    {connectionState ? (
                        <ConnectionStateView
                            state={connectionState}
                            onRetry={() => retryConnection()}
                            t={t}
                        />
                    ) : (
                        <LoginForm
                            activeTab={activeTab}
                            adminLoginPending={adminLoginMutation.isPending}
                            onAdminPasswordSubmit={adminLoginMutation.mutate}
                            onPasskeyLogin={handlePasskeyLogin}
                            onPasswordChange={setPassword}
                            onResetPassword={showResetInstructions}
                            onShowPasswordChange={setShowPassword}
                            onShowVisitorPasswordChange={setShowVisitorPassword}
                            onTabChange={setActiveTab}
                            onVisitorPasswordChange={setVisitorPassword}
                            onVisitorPasswordSubmit={visitorLoginMutation.mutate}
                            passkeyLoginPending={passkeyLoginMutation.isPending}
                            passkeysExist={passkeysExist}
                            password={password}
                            passwordLoginAllowed={passwordLoginAllowed}
                            showPassword={showPassword}
                            showVisitorPassword={showVisitorPassword}
                            showVisitorTab={showVisitorTab}
                            t={t}
                            visitorLoginPending={visitorLoginMutation.isPending}
                            visitorPassword={visitorPassword}
                            waitTime={waitTime}
                            websiteName={websiteName}
                        />
                    )}
                </Box>
            </Container>
            <Box sx={{ pb: 3, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <VersionInfo showUpdateBadge={false} />
            </Box>
            <AlertModal
                open={alertOpen}
                onClose={() => setAlertOpen(false)}
                title={alertTitle}
                message={alertMessage}
            />
        </Box>
    );
};

export default LoginPage;
