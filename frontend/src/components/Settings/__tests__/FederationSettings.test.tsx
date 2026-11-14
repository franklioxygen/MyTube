import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FederationSettings from '../FederationSettings';

const api = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
}));
const showSnackbar = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    }),
}));
vi.mock('../../../contexts/SnackbarContext', () => ({ useSnackbar: () => ({ showSnackbar }) }));
vi.mock('../../../utils/apiClient', () => ({
    api,
    getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
const copyTextToClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>(async () => true));
vi.mock('../../../utils/clipboard', () => ({ copyTextToClipboard }));

const INSTANCE_ID = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const CREDENTIAL = `${'A'.repeat(16)}.${'B'.repeat(43)}`;

const token = (overrides: Record<string, unknown> = {}) => ({
    id: 'token-1',
    label: 'Living room',
    scopes: ['library:read', 'media:read'],
    visibilityCeiling: 'public',
    consumerInstanceId: null,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: 0,
    status: 'active',
    ...overrides,
});

const peer = (overrides: Record<string, unknown> = {}) => ({
    id: 'peer-1',
    peerInstanceId: 'peer-instance',
    name: 'NAS',
    baseUrl: 'http://192.168.1.20:5551',
    lanException: true,
    audience: 'public',
    canStreamMedia: true,
    enabled: true,
    status: 'ok',
    lastError: null,
    lastSuccessAt: 0,
    ...overrides,
});

let tokens: ReturnType<typeof token>[];
let peers: ReturnType<typeof peer>[];

const renderSettings = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <FederationSettings />
        </QueryClientProvider>
    );

beforeEach(() => {
    vi.clearAllMocks();
    tokens = [token()];
    peers = [peer()];
    api.get.mockImplementation(async (url: string) => {
        if (url === '/federation/tokens') return { data: { instanceId: INSTANCE_ID, tokens } };
        if (url === '/federation/peers') return { data: { peers } };
        throw new Error(`unexpected ${url}`);
    });
    api.post.mockResolvedValue({ data: {} });
    api.patch.mockResolvedValue({ data: {} });
    api.put.mockResolvedValue({ data: {} });
    api.delete.mockResolvedValue({ data: { removedItems: 0 } });
});

const confirmDialog = async (confirmLabel: string) => {
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: confirmLabel }));
};

describe('federation access keys', () => {
    it('shows this instance and issues a key that is revealed once', async () => {
        api.post.mockResolvedValueOnce({ data: { token: token({ id: 'token-2' }), credential: CREDENTIAL } });
        renderSettings();

        expect(await screen.findByText(INSTANCE_ID)).toBeInTheDocument();
        expect(screen.getByText('Living room')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'federationCreateToken' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText('federationTokenLabel'), { target: { value: '  Den  ' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'federationCreateToken' }));

        await waitFor(() =>
            expect(api.post).toHaveBeenCalledWith('/federation/tokens', {
                label: 'Den',
                scopes: ['library:read', 'media:read'],
                visibilityCeiling: 'public',
                expiresAt: null,
            })
        );
        expect(await screen.findByDisplayValue(CREDENTIAL)).toBeInTheDocument();

        // The footer button; the header has its own close icon.
        const closeButtons = screen.getAllByRole('button', { name: 'close' });
        fireEvent.click(closeButtons[closeButtons.length - 1]);
        await waitFor(() => expect(screen.queryByDisplayValue(CREDENTIAL)).not.toBeInTheDocument());
    });

    it('tells the owner to copy the key by hand when the clipboard fails', async () => {
        api.post.mockResolvedValueOnce({ data: { token: token(), credential: CREDENTIAL } });
        copyTextToClipboard.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(false);
        renderSettings();

        fireEvent.click(await screen.findByRole('button', { name: 'federationRotate' }));
        await confirmDialog('federationRotate');
        expect(await screen.findByDisplayValue(CREDENTIAL)).toBeInTheDocument();

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            fireEvent.click(screen.getByRole('button', { name: 'federationCopy' }));
            await waitFor(() =>
                expect(showSnackbar.mock.calls.filter(([message]) => message === 'federationCopyFailed')).toHaveLength(attempt)
            );
        }
        expect(showSnackbar).toHaveBeenCalledWith('federationCopyFailed', 'error');
    });

    it('rotates a key after confirmation and reveals the replacement', async () => {
        api.post.mockResolvedValueOnce({ data: { token: token(), credential: CREDENTIAL } });
        renderSettings();

        fireEvent.click(await screen.findByRole('button', { name: 'federationRotate' }));
        await confirmDialog('federationRotate');

        await waitFor(() => expect(api.post).toHaveBeenCalledWith('/federation/tokens/token-1/rotate'));
        expect(await screen.findByDisplayValue(CREDENTIAL)).toBeInTheDocument();
    });

    it('offers to resume a key suspended by a restore', async () => {
        tokens = [token({ status: 'suspended' })];
        renderSettings();

        expect(await screen.findByText('federationTokenSuspendedHint')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'resume' }));

        await waitFor(() => expect(api.post).toHaveBeenCalledWith('/federation/tokens/token-1/resume'));
    });

    it('resets the identity only after confirmation', async () => {
        api.post.mockResolvedValueOnce({ data: { instanceId: 'new', revokedTokens: 1 } });
        renderSettings();

        fireEvent.click(await screen.findByRole('button', { name: 'federationResetIdentity' }));
        expect(api.post).not.toHaveBeenCalled();
        await confirmDialog('federationResetIdentity');

        await waitFor(() => expect(api.post).toHaveBeenCalledWith('/federation/identity/reset'));
        expect(showSnackbar).toHaveBeenCalledWith('federationResetIdentityDone:{"count":1}', 'success');
    });

    it('reports a failed action', async () => {
        api.post.mockRejectedValueOnce(new Error('scopes must be a non-empty array'));
        renderSettings();

        fireEvent.click(await screen.findByRole('button', { name: 'federationCreateToken' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'federationCreateToken' }));

        await waitFor(() =>
            expect(showSnackbar).toHaveBeenCalledWith(
                'federationActionFailed:{"error":"scopes must be a non-empty array"}',
                'error'
            )
        );
    });
});

describe('connected instances', () => {
    it('connects an instance with the trimmed form values', async () => {
        renderSettings();

        fireEvent.click(await screen.findByRole('button', { name: 'federationAddPeer' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText('name'), { target: { value: ' Office ' } });
        fireEvent.change(within(dialog).getByLabelText('federationPeerUrl'), { target: { value: ' http://10.0.0.2:5551 ' } });
        fireEvent.change(within(dialog).getByLabelText('federationPeerCredential'), { target: { value: ` ${CREDENTIAL} ` } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'save' }));

        await waitFor(() =>
            expect(api.post).toHaveBeenCalledWith('/federation/peers', {
                name: 'Office',
                baseUrl: 'http://10.0.0.2:5551',
                credential: CREDENTIAL,
            })
        );
        expect(showSnackbar).toHaveBeenCalledWith('federationPeerAdded', 'success');
    });

    it('shows each peer state and the last error', async () => {
        peers = [peer({ status: 'credential_rejected', lastError: 'The peer refused the credential.' })];
        renderSettings();

        expect(await screen.findByText('federationPeerStatusCredentialRejected')).toBeInTheDocument();
        expect(screen.getByText('The peer refused the credential.')).toBeInTheDocument();
        expect(screen.getByText('federationPeerLan')).toBeInTheDocument();
    });

    it('syncs now and reports success or failure', async () => {
        api.post
            .mockResolvedValueOnce({ data: { result: { status: 'ok', changed: true }, peer: peer() } })
            .mockResolvedValueOnce({ data: { result: { status: 'error', changed: false, error: 'unreachable' }, peer: peer() } });
        renderSettings();

        fireEvent.click(await screen.findByRole('button', { name: 'federationSyncNow' }));
        await waitFor(() =>
            expect(showSnackbar).toHaveBeenCalledWith('federationSyncDone:{"name":"NAS"}', 'success')
        );

        fireEvent.click(await screen.findByRole('button', { name: 'federationSyncNow' }));
        await waitFor(() =>
            expect(showSnackbar).toHaveBeenCalledWith(
                'federationSyncFailed:{"name":"NAS","error":"unreachable"}',
                'error'
            )
        );
        expect(api.post).toHaveBeenCalledWith('/federation/peers/peer-1/sync');
    });

    it('keeps each peer busy until its own operation ends', async () => {
        peers = [peer(), peer({ id: 'peer-2', name: 'Office' })];
        let finishFirst!: () => void;
        api.post
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finishFirst = () => resolve({ data: { result: { status: 'ok', changed: true }, peer: peer() } });
                    })
            )
            .mockResolvedValueOnce({ data: { result: { status: 'ok', changed: true }, peer: peer() } });
        renderSettings();

        const syncButtons = await screen.findAllByRole('button', { name: 'federationSyncNow' });
        fireEvent.click(syncButtons[0]);
        fireEvent.click(syncButtons[1]);
        // The second finishing must not release the first.
        await waitFor(() => expect(showSnackbar).toHaveBeenCalledWith('federationSyncDone:{"name":"Office"}', 'success'));
        expect(screen.getAllByRole('button', { name: 'remove' })[0]).toBeDisabled();

        finishFirst();
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'remove' })[0]).toBeEnabled());
    });

    it('disables a peer and removes one after confirmation', async () => {
        api.delete.mockResolvedValueOnce({ data: { removedItems: 12 } });
        renderSettings();

        fireEvent.click(await screen.findByLabelText('federationPeerEnabled'));
        await waitFor(() =>
            expect(api.patch).toHaveBeenCalledWith('/federation/peers/peer-1', { enabled: false })
        );

        fireEvent.click(screen.getByRole('button', { name: 'remove' }));
        await confirmDialog('remove');
        await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/federation/peers/peer-1'));
        expect(showSnackbar).toHaveBeenCalledWith('federationRemovePeerDone:{"name":"NAS","count":12}', 'success');
    });
});
