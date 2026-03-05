import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UploadThumbnailModal from '../UploadThumbnailModal';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

describe('UploadThumbnailModal', () => {
    const createObjectURLMock = vi.fn((file: File) => `blob:${file.name}`);
    const revokeObjectURLMock = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: createObjectURLMock,
            writable: true,
        });
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: revokeObjectURLMock,
            writable: true,
        });
    });

    const renderModal = (props: Partial<ComponentProps<typeof UploadThumbnailModal>> = {}) => {
        const onClose = vi.fn();
        const onUpload = vi.fn().mockResolvedValue(undefined);
        const view = render(
            <UploadThumbnailModal
                open={true}
                onClose={onClose}
                onUpload={onUpload}
                {...props}
            />
        );

        return {
            ...view,
            onClose,
            onUpload,
        };
    };

    const selectFile = (file: File) => {
        const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
        if (!input) {
            throw new Error('file input not found');
        }
        fireEvent.change(input, { target: { files: [file] } });
    };

    it('renders dialog and placeholder UI', () => {
        renderModal();

        expect(screen.getByText('uploadThumbnail')).toBeInTheDocument();
        expect(screen.getByText('clickToSelectImage')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'selectImage' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'upload' })).toBeDisabled();
    });

    it('shows preview after selecting a file and updates primary actions', () => {
        renderModal();
        const file = new File(['thumb'], 'thumb-1.png', { type: 'image/png' });

        selectFile(file);

        expect(createObjectURLMock).toHaveBeenCalledWith(file);
        expect(screen.getByAltText('preview')).toHaveAttribute('src', 'blob:thumb-1.png');
        expect(screen.getByRole('button', { name: 'changeImage' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'upload' })).toBeEnabled();
    });

    it('revokes old preview URL when selecting another file', () => {
        renderModal();
        const firstFile = new File(['a'], 'first.png', { type: 'image/png' });
        const secondFile = new File(['b'], 'second.png', { type: 'image/png' });

        selectFile(firstFile);
        selectFile(secondFile);

        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:first.png');
        expect(screen.getByAltText('preview')).toHaveAttribute('src', 'blob:second.png');
    });

    it('uploads selected file successfully and closes modal', async () => {
        const { onClose, onUpload } = renderModal();
        const file = new File(['ok'], 'upload-ok.png', { type: 'image/png' });
        selectFile(file);

        fireEvent.click(screen.getByRole('button', { name: 'upload' }));

        await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:upload-ok.png');
    });

    it('shows upload error and allows dismissing alert', async () => {
        const uploadError = { response: { data: { error: 'invalid image format' } } };
        renderModal({
            onUpload: vi.fn().mockRejectedValue(uploadError),
        });
        const file = new File(['bad'], 'bad.webp', { type: 'image/webp' });
        selectFile(file);

        fireEvent.click(screen.getByRole('button', { name: 'upload' }));

        const alert = await screen.findByText('invalid image format');
        fireEvent.click(within(alert.parentElement as HTMLElement).getByRole('button'));
        await waitFor(() => {
            expect(screen.queryByText('invalid image format')).not.toBeInTheDocument();
        });
    });

    it('cleans up preview and calls onClose when cancel is clicked', () => {
        const { onClose } = renderModal();
        const file = new File(['x'], 'cancel.png', { type: 'image/png' });
        selectFile(file);

        fireEvent.click(screen.getByRole('button', { name: 'cancel' }));

        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:cancel.png');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByAltText('preview')).not.toBeInTheDocument();
    });

    it('keeps modal open and disables cancel while upload is in progress', async () => {
        const neverResolvedUpload = vi.fn(() => new Promise<void>(() => { }));
        const { onClose } = renderModal({ onUpload: neverResolvedUpload });
        const file = new File(['busy'], 'busy.png', { type: 'image/png' });
        selectFile(file);

        fireEvent.click(screen.getByRole('button', { name: 'upload' }));

        const cancelButton = await screen.findByRole('button', { name: 'cancel' });
        expect(cancelButton).toBeDisabled();
        expect(screen.getByRole('button', { name: 'uploading' })).toBeDisabled();
        fireEvent.click(cancelButton);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('revokes preview URL on unmount cleanup', () => {
        const { unmount } = renderModal();
        const file = new File(['bye'], 'unmount.png', { type: 'image/png' });
        selectFile(file);

        unmount();

        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:unmount.png');
    });
});
