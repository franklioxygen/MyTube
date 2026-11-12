import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthorAvatarEditor from '../AuthorAvatarEditor';

const state = vi.hoisted(() => ({ save: vi.fn(), refetch: vi.fn(), notify: vi.fn(), fetchSource: vi.fn(), sources: [] as Array<{ platform: string; channelUrl: string }> }));
vi.mock('../../hooks/useAuthorProfile', () => ({ useAuthorProfile: (author: string) => ({
    data: { author, customAvatarPath: '/avatars/custom.jpg', effectiveAvatarPath: '/avatars/custom.jpg', defaultAvatarPath: '/avatars/auto.jpg', avatarOrigin: 'custom', videoCount: 5, avatarSources: state.sources },
    fetchFromSource: state.fetchSource, save: state.save, refetch: state.refetch, isPending: false, isError: false,
}) }));
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('../../contexts/SnackbarContext', () => ({ useSnackbar: () => ({ showSnackbar: state.notify }) }));
vi.mock('../../hooks/useCloudStorageUrl', () => ({ useCloudStorageUrl: (path: string) => path }));

beforeEach(() => { vi.clearAllMocks(); state.sources = []; state.fetchSource.mockReset(); state.save.mockResolvedValue({}); state.refetch.mockResolvedValue({}); });
vi.mock('../../utils/avatarCrop', async importOriginal => ({
    ...await importOriginal<object>(), validateAvatarImage: vi.fn().mockResolvedValue(undefined), exportAvatar: vi.fn(async () => new Blob(['cropped'], { type: 'image/png' })),
}));
const createObjectURL = URL.createObjectURL;
const revokeObjectURL = URL.revokeObjectURL;
afterEach(() => { vi.unstubAllGlobals(); URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL; });

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
    it('explains when a local author has no channel', () => {
        render(<AuthorAvatarEditor author="Local" onClose={vi.fn()} />);
        expect(screen.getByText('authorAvatarSourceUnavailable')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'authorAvatarSourceFetch' })).not.toBeInTheDocument();
    });
    it('only previews fetched images until explicit save', async () => {
        state.sources = [{ platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' }];
        state.fetchSource.mockResolvedValue(new File(['image'], 'source.png', { type: 'image/png' }));
        vi.stubGlobal('Image', class { naturalWidth = 512; naturalHeight = 512; src = ''; decode = async () => undefined; });
        URL.createObjectURL = vi.fn(() => 'blob:source'); URL.revokeObjectURL = vi.fn();
        const close = vi.fn(); render(<AuthorAvatarEditor author="A" onClose={close} />);
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarSourceFetch' }));
        await screen.findByText('authorAvatarSourcePreview');
        expect(state.fetchSource).toHaveBeenCalledExactlyOnceWith('https://www.youtube.com/@test', expect.any(AbortSignal));
        expect(state.save).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarSave' }));
        await waitFor(() => expect(close).toHaveBeenCalledOnce());
        expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.any(Blob));
    });
    it('requires an explicit channel choice for multiple sources', async () => {
        state.sources = [{ platform: 'youtube', channelUrl: 'https://www.youtube.com/@one' }, { platform: 'bilibili', channelUrl: 'https://space.bilibili.com/123' }];
        state.fetchSource.mockRejectedValue(new Error('offline'));
        render(<AuthorAvatarEditor author="A" onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'authorAvatarSourceFetch' })).toBeDisabled();
        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'authorAvatarSourceChannel' }));
        fireEvent.click(await screen.findByRole('option', { name: 'https://space.bilibili.com/123' }));
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarSourceFetch' }));
        await screen.findByText('authorAvatarSourceError');
        expect(state.fetchSource).toHaveBeenCalledExactlyOnceWith('https://space.bilibili.com/123', expect.any(AbortSignal));
        expect(state.save).not.toHaveBeenCalled();
    });
    it('allows cancelling a slow source fetch without changing saved data', async () => {
        state.sources = [{ platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' }];
        state.fetchSource.mockReturnValue(new Promise(() => undefined));
        const close = vi.fn(); render(<AuthorAvatarEditor author="A" onClose={close} />);
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarSourceFetch' }));
        expect(screen.getByRole('button', { name: 'authorAvatarSave' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
        expect(close).toHaveBeenCalledOnce();
        expect(state.fetchSource.mock.calls[0][1].aborted).toBe(true);
        expect(state.save).not.toHaveBeenCalled();
    });
    it('retains the current draft after source errors', async () => {
        state.sources = [{ platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' }];
        state.fetchSource.mockRejectedValue(new Error('offline'));
        render(<AuthorAvatarEditor author="A" onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarRestore' }));
        fireEvent.click(screen.getByRole('button', { name: 'authorAvatarSourceFetch' }));
        await screen.findByText('authorAvatarSourceError');
        expect(screen.getByText('authorAvatarRestoring')).toBeInTheDocument();
        expect(state.save).not.toHaveBeenCalled();
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
