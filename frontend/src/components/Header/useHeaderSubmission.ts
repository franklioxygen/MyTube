import { FormEvent, useState } from 'react';
import { NavigateFunction } from 'react-router-dom';
import { TranslationKey } from '../../utils/translations';

interface HeaderSubmitResult {
    success?: boolean;
    isSearchTerm?: boolean;
    error?: string;
}

type TranslateFn = (key: TranslationKey, replacements?: Record<string, string | number>) => string;

interface UseHeaderSubmissionParams {
    onSubmit: (url: string) => Promise<HeaderSubmitResult>;
    onAudioOnlySubmit?: (url: string) => Promise<HeaderSubmitResult>;
    isVisitor: boolean;
    navigate: NavigateFunction;
    t: TranslateFn;
    onCloseMobileMenu: () => void;
}

const isHttpUrl = (value: string): boolean => {
    const urlRegex = /^(https?:\/\/[^\s]+)/;
    return urlRegex.test(value);
};

const toSearchPath = (value: string): string => `/search?q=${encodeURIComponent(value)}`;

export const useHeaderSubmission = ({
    onSubmit,
    onAudioOnlySubmit,
    isVisitor,
    navigate,
    t,
    onCloseMobileMenu
}: UseHeaderSubmissionParams) => {
    const [videoUrl, setVideoUrl] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const resetInputAndCloseMenu = () => {
        setVideoUrl('');
        onCloseMobileMenu();
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (!videoUrl.trim()) {
            setError(t('pleaseEnterUrlOrSearchTerm'));
            return;
        }

        const input = videoUrl.trim();
        const inputIsUrl = isHttpUrl(input);
        setError('');
        setIsSubmitting(true);

        try {
            if (!inputIsUrl) {
                resetInputAndCloseMenu();
                navigate(toSearchPath(input));
                return;
            }

            if (isVisitor) {
                setError(t('visitorModeUrlRestricted') || 'Visitors cannot process URLs');
                return;
            }

            const result = await onSubmit(input);
            if (result.success) {
                resetInputAndCloseMenu();
                return;
            }

            if (result.isSearchTerm) {
                resetInputAndCloseMenu();
                navigate(toSearchPath(input));
                return;
            }

            setError(result.error || t('unexpectedErrorOccurred'));
        } catch (submitError) {
            setError(t('unexpectedErrorOccurred'));
            console.error(submitError);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAudioSubmit = async (url: string): Promise<HeaderSubmitResult> => {
        const input = url.trim();
        if (!input) {
            setError(t('pleaseEnterUrlOrSearchTerm'));
            return { success: false, error: t('pleaseEnterUrlOrSearchTerm') };
        }

        if (isVisitor) {
            const errorMessage = t('visitorModeUrlRestricted') || 'Visitors cannot process URLs';
            setError(errorMessage);
            return { success: false, error: errorMessage };
        }

        if (!onAudioOnlySubmit) {
            return { success: false, error: t('unexpectedErrorOccurred') };
        }

        setError('');
        setIsSubmitting(true);
        try {
            const result = await onAudioOnlySubmit(input);
            if (result.success) {
                resetInputAndCloseMenu();
                return result;
            }

            setError(result.error || t('unexpectedErrorOccurred'));
            return result;
        } catch (submitError) {
            setError(t('unexpectedErrorOccurred'));
            console.error(submitError);
            return { success: false, error: t('unexpectedErrorOccurred') };
        } finally {
            setIsSubmitting(false);
        }
    };

    return {
        videoUrl,
        setVideoUrl,
        isSubmitting,
        error,
        handleSubmit,
        handleAudioSubmit,
    };
};
