import { startAuthentication } from '@simplewebauthn/browser';
import { useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import {
    api,
    ensureCsrfToken,
    getWaitTime,
    isAuthError,
    isRateLimitError,
} from '../../utils/apiClient';
import {
    createTranslateOrFallback,
    type TranslateFn,
} from '../../utils/translateOrFallback';
import {
    formatWaitTime,
    getPasskeyErrorMessage,
    getPasswordErrorMessage,
    isLocalWebAuthnHost,
    isWebAuthnSupported,
} from './loginUtils';

type LoginHandler = (role?: string) => void;
type AlertHandler = (title: string, message: string) => void;

interface LoginResponse {
    role?: string;
    success?: boolean;
}

interface UseLoginActionsArgs {
    login: LoginHandler;
    setWaitTime: Dispatch<SetStateAction<number>>;
    showAlert: AlertHandler;
    t: TranslateFn;
}

export const useLoginActions = ({
    login,
    setWaitTime,
    showAlert,
    t,
}: UseLoginActionsArgs) => {
    const getTranslatedOrFallback = createTranslateOrFallback(t);

    const showResetInstructions = () => {
        const title = t('resetPassword') || 'Reset Password';
        const message = getTranslatedOrFallback(
            'resetPasswordRecoveryMessage',
            'Password recovery must be performed from the backend environment. Set a new password explicitly instead of relying on generated credentials in logs.'
        );
        const guide = getTranslatedOrFallback(
            'resetPasswordRecoveryGuide',
            [
                'Choose the command that matches your environment:',
                '',
                'Backend shell',
                '  node dist/scripts/reset-password.js <new-password>',
                '',
                'Docker host',
                '  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>',
                '',
                'Use the backend directory/container that has access to the persistent app data.',
            ].join('\n')
        );

        showAlert(title, `${message}\n\n${guide}`);
    };

    const handlePasswordLoginError = (error: unknown, fallbackMessage: string) => {
        console.error('Login error:', error);

        const waitTimeMs = getWaitTime(error);
        const message = getPasswordErrorMessage(error, fallbackMessage);

        if (isRateLimitError(error)) {
            setWaitTime(waitTimeMs);
            const formattedTime = formatWaitTime(waitTimeMs);
            showAlert(t('error'), `${t('tooManyAttempts')} ${t('waitTimeMessage').replace('{time}', formattedTime)}`);
            return;
        }

        if (isAuthError(error)) {
            if (waitTimeMs > 0) {
                setWaitTime(waitTimeMs);
                const formattedTime = formatWaitTime(waitTimeMs);
                showAlert(t('error'), `${message} ${t('waitTimeMessage').replace('{time}', formattedTime)}`);
                return;
            }

            showAlert(t('error'), message);
            return;
        }

        showAlert(t('error'), t('loginFailed'));
    };

    const adminLoginMutation = useMutation<LoginResponse, unknown, string>({
        mutationFn: async (passwordToVerify: string) => {
            await ensureCsrfToken({ refresh: true });
            const response = await api.post<LoginResponse>(
                '/settings/verify-admin-password',
                { password: passwordToVerify }
            );
            return response.data;
        },
        onSuccess: (data) => {
            setWaitTime(0);
            login(data.role);
        },
        onError: (error: unknown) => {
            handlePasswordLoginError(error, t('incorrectPassword'));
        },
    });

    const visitorLoginMutation = useMutation<LoginResponse, unknown, string>({
        mutationFn: async (passwordToVerify: string) => {
            await ensureCsrfToken({ refresh: true });
            const response = await api.post<LoginResponse>(
                '/settings/verify-visitor-password',
                { password: passwordToVerify }
            );
            return response.data;
        },
        onSuccess: (data) => {
            setWaitTime(0);
            login(data.role);
        },
        onError: (error: unknown) => {
            handlePasswordLoginError(error, t('incorrectPassword'));
        },
    });

    const passkeyLoginMutation = useMutation<LoginResponse>({
        mutationFn: async () => {
            const optionsResponse = await api.post('/settings/passkeys/authenticate');
            const { options, challenge } = optionsResponse.data;

            const assertionResponse = await startAuthentication({
                optionsJSON: options,
            });

            const verifyResponse = await api.post<LoginResponse>(
                '/settings/passkeys/authenticate/verify',
                {
                    body: assertionResponse,
                    challenge,
                }
            );

            if (!verifyResponse.data.success) {
                throw new Error('Passkey authentication failed');
            }

            return verifyResponse.data;
        },
        onSuccess: (data) => {
            setWaitTime(0);
            if (data.role) {
                login(data.role);
            } else {
                login();
            }
        },
        onError: (error: unknown) => {
            console.error('Passkey login error:', error);
            const fallbackMessage =
                t('passkeyLoginFailed') ||
                'Passkey authentication failed. Please try again.';
            showAlert(t('error'), getPasskeyErrorMessage(error, fallbackMessage, t));
        },
    });

    const handlePasskeyLogin = () => {
        if (!window.isSecureContext && !isLocalWebAuthnHost(window.location.hostname)) {
            showAlert(
                t('error'),
                t('passkeyRequiresHttps') ||
                'WebAuthn requires HTTPS or localhost. Please access the application via HTTPS or use localhost instead of an IP address.'
            );
            return;
        }

        if (!isWebAuthnSupported()) {
            showAlert(
                t('error'),
                t('passkeyWebAuthnNotSupported') ||
                'WebAuthn is not supported in this browser. Please use a modern browser that supports WebAuthn.'
            );
            return;
        }

        passkeyLoginMutation.mutate();
    };

    return {
        adminLoginMutation,
        visitorLoginMutation,
        passkeyLoginMutation,
        handlePasskeyLogin,
        showResetInstructions,
    };
};
