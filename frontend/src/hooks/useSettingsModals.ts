import { useState } from 'react';

export interface InfoModalState {
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
}

/**
 * Custom hook to manage all modal states in SettingsPage
 */
export function useSettingsModals() {
    const [showDeleteLegacyModal, setShowDeleteLegacyModal] = useState(false);
    const [showFormatConfirmModal, setShowFormatConfirmModal] = useState(false);
    const [showMigrateConfirmModal, setShowMigrateConfirmModal] = useState(false);
    const [showCleanupTempFilesModal, setShowCleanupTempFilesModal] = useState(false);
    const [infoModal, setInfoModal] = useState<InfoModalState>({
        isOpen: false,
        title: '',
        message: '',
        type: 'info'
    });

    return {
        showDeleteLegacyModal,
        setShowDeleteLegacyModal,
        showFormatConfirmModal,
        setShowFormatConfirmModal,
        showMigrateConfirmModal,
        setShowMigrateConfirmModal,
        showCleanupTempFilesModal,
        setShowCleanupTempFilesModal,
        infoModal,
        setInfoModal
    };
}
