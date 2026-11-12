import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthorAvatarEditor from '../AuthorAvatarEditor';

const state = vi.hoisted(() => ({ save: vi.fn(), refetch: vi.fn(), notify: vi.fn() }));
vi.mock('../../hooks/useAuthorProfile', () => ({ useAuthorProfile: (author: string) => ({
    data: { author, customAvatarPath: '/avatars/custom.jpg', effectiveAvatarPath: '/avatars/custom.jpg', defaultAvatarPath: '/avatars/auto.jpg', avatarOrigin: 'custom', videoCount: 5 },
    save: state.save, refetch: state.refetch, isPending: false, isError: false,
}) }));
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('../../contexts/SnackbarContext', () => ({ useSnackbar: () => ({ showSnackbar: state.notify }) }));
vi.mock('../../hooks/useCloudStorageUrl', () => ({ useCloudStorageUrl: (path: string) => path }));

beforeEach(() => { vi.clearAllMocks(); state.save.mockResolvedValue({}); state.refetch.mockResolvedValue({}); });
describe('AuthorAvatarEditor', () => {
    it('does not write on cancel or on selecting the default preview', () => {
        const close = vi.fn(); render(<AuthorAvatarEditor author="A" onClose={close} />);
        expect(screen.getByRole('button', { name: 'authorAvatarSave' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarRestore' }));
        expect(screen.getByText('authorAvatarRestoring')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
        expect(close).toHaveBeenCalledOnce(); expect(state.save).not.toHaveBeenCalled();
    });
    it('only restores after explicit save and closes after success', async () => {
        const close = vi.fn(); render(<AuthorAvatarEditor author="A" onClose={close} />);
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarRestore' }));
        fireEvent.click(screen.getByRole('button', { name: 'save' }));
        await waitFor(() => expect(close).toHaveBeenCalledOnce());
        expect(state.save).toHaveBeenCalledExactlyOnceWith(null);
        expect(state.notify).toHaveBeenCalledWith('authorAvatarSaved', 'success');
    });
    it('keeps the draft open and reloads actual state after a failed save', async () => {
        state.save.mockRejectedValueOnce(new Error('timeout'));
        const close = vi.fn(); render(<AuthorAvatarEditor author="A" onClose={close} />);
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarRestore' }));
        fireEvent.click(screen.getByRole('button', { name: 'save' }));
        await screen.findByRole('alert');
        expect(close).not.toHaveBeenCalled(); expect(state.refetch).toHaveBeenCalledOnce();
        expect(screen.getByText('authorAvatarRestoring')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'save' })).toBeEnabled());
    });
    it('clears an unsaved draft when a different author is mounted', () => {
        const props = { onClose: vi.fn() };
        const view = render(<AuthorAvatarEditor key="A" author="A" {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarRestore' }));
        view.rerender(<AuthorAvatarEditor key="B" author="B" {...props} />);
        expect(screen.queryByText('authorAvatarRestoring')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'authorAvatarSave' })).toBeDisabled();
        expect(state.save).not.toHaveBeenCalled();
    });
});
