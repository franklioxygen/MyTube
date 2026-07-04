import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserManagementSettings from '../UserManagementSettings';
import { userApi } from '../../../utils/userApi';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

let mockUserRole: 'admin' | 'visitor' | null = 'admin';
vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: mockUserRole }),
}));

vi.mock('../../../utils/userApi', () => ({
    userApi: {
        fetchUsers: vi.fn(),
        createUser: vi.fn(),
        updateUser: vi.fn(),
        deleteUser: vi.fn(),
    },
}));

const visitorUser = {
    id: 'user-1',
    username: 'alice',
    role: 'visitor' as const,
    enabled: true,
    isLegacyShared: false,
    createdAt: 1000,
    updatedAt: 1000,
    lastLoginAt: null,
};

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

const renderComponent = () =>
    render(
        <QueryClientProvider client={createQueryClient()}>
            <UserManagementSettings loginEnabled={true} visitorUserEnabled={true} />
        </QueryClientProvider>
    );

describe('UserManagementSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUserRole = 'admin';
        vi.mocked(userApi.fetchUsers).mockResolvedValue([visitorUser]);
        vi.mocked(userApi.createUser).mockResolvedValue(visitorUser);
        vi.mocked(userApi.updateUser).mockResolvedValue(visitorUser);
        vi.mocked(userApi.deleteUser).mockResolvedValue(undefined);
        Object.defineProperty(window, 'crypto', {
            configurable: true,
            value: {
                getRandomValues: (array: Uint8Array) => {
                    array.fill(1);
                    return array;
                },
            },
        });
    });

    it('renders visitor users without password hashes', async () => {
        renderComponent();

        expect(await screen.findByText('alice')).toBeInTheDocument();
        expect(screen.getByText('userEnabled')).toBeInTheDocument();
        expect(screen.getByText('userNeverLoggedIn')).toBeInTheDocument();
        expect(screen.queryByText('passwordHash')).not.toBeInTheDocument();
    });

    it('creates a visitor user from the add dialog', async () => {
        const user = userEvent.setup();
        vi.mocked(userApi.fetchUsers).mockResolvedValue([]);
        renderComponent();

        await user.click(await screen.findByRole('button', { name: 'addVisitorUser' }));
        await user.type(screen.getByLabelText('username'), 'bob');
        await user.type(screen.getByLabelText('password'), 'secret1');
        await user.click(screen.getByRole('button', { name: 'save' }));

        await waitFor(() => {
            expect(userApi.createUser).toHaveBeenCalledWith(expect.objectContaining({
                username: 'bob',
                password: 'secret1',
            }), expect.anything());
        });
    });

    it('confirms disable before patching enabled false', async () => {
        const user = userEvent.setup();
        renderComponent();

        await screen.findByText('alice');
        const disableInput = screen
            .getAllByLabelText('disableUser')
            .find((element) => element.tagName === 'INPUT');
        expect(disableInput).toBeDefined();
        await user.click(disableInput!);
        await user.click(screen.getByRole('button', { name: 'disableUser' }));

        await waitFor(() => {
            expect(userApi.updateUser).toHaveBeenCalledWith('user-1', {
                enabled: false,
            });
        });
    });

    it('deletes a user after confirmation', async () => {
        const user = userEvent.setup();
        renderComponent();

        await screen.findByText('alice');
        await user.click(screen.getByRole('button', { name: 'deleteUser' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('userDeleteConfirm')).toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: 'deleteUser' }));

        await waitFor(() => {
            expect(userApi.deleteUser).toHaveBeenCalledWith('user-1', expect.anything());
        });
    });

    it('shows the legacy tooltip icon only for migrated accounts', async () => {
        vi.mocked(userApi.fetchUsers).mockResolvedValue([
            visitorUser,
            { ...visitorUser, id: 'user-2', username: 'visitor', isLegacyShared: true },
        ]);
        renderComponent();

        await screen.findByText('visitor');
        expect(screen.getAllByTestId('InfoOutlinedIcon')).toHaveLength(1);
    });

    it('shows inline validation and blocks saving for invalid usernames', async () => {
        const user = userEvent.setup();
        vi.mocked(userApi.fetchUsers).mockResolvedValue([]);
        renderComponent();

        await user.click(await screen.findByRole('button', { name: 'addVisitorUser' }));
        await user.type(screen.getByLabelText('username'), 'a!');
        await user.type(screen.getByLabelText('password'), 'secret1');

        expect(await screen.findByText('userUsernameInvalid')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
        expect(userApi.createUser).not.toHaveBeenCalled();
    });

    it('is hidden for visitor sessions', () => {
        mockUserRole = 'visitor';
        renderComponent();

        expect(screen.queryByText('visitorAccounts')).not.toBeInTheDocument();
        expect(userApi.fetchUsers).not.toHaveBeenCalled();
    });
});
