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

    return {
        videoUrl,
        setVideoUrl,
        isSubmitting,
        error,
        handleSubmit
    };
};
