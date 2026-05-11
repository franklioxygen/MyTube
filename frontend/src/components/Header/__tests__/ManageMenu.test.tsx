import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManageMenu from '../ManageMenu';

const mockNavigate = vi.fn();
const mockLogout = vi.fn();
let mockLoginEnabled = false;
let mockUserRole = 'admin';

vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({
        logout: mockLogout,
        userRole: mockUserRole,
    }),
}));

vi.mock('../../../hooks/useSettings', () => ({
    useSettings: () => ({
        data: { loginEnabled: mockLoginEnabled, statisticsEnabled: false },
    }),
}));

describe('ManageMenu', () => {
    const anchorEl = document.createElement('button');
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockLoginEnabled = false;
        mockUserRole = 'admin';
        document.body.appendChild(anchorEl);
    });

    it('navigates to manage, settings, and instruction pages from menu items', () => {
        render(<ManageMenu anchorEl={anchorEl} onClose={onClose} />);

        fireEvent.click(screen.getByRole('menuitem', { name: /manageContent/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /settings/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /instruction/i }));

        expect(onClose).toHaveBeenCalledTimes(3);
        expect(mockNavigate).toHaveBeenNthCalledWith(1, '/manage');
        expect(mockNavigate).toHaveBeenNthCalledWith(2, '/settings');
        expect(mockNavigate).toHaveBeenNthCalledWith(3, '/instruction');
    });

    it('shows statistics navigation for admins even when collection is disabled', () => {
        render(<ManageMenu anchorEl={anchorEl} onClose={onClose} />);

        expect(screen.getByRole('menuitem', { name: /statisticsTitle/i })).toBeInTheDocument();
    });

    it('hides logout when login is disabled', () => {
        render(<ManageMenu anchorEl={anchorEl} onClose={onClose} />);

        expect(screen.queryByRole('menuitem', { name: /logout/i })).not.toBeInTheDocument();
    });

    it('shows logout when login is enabled and logs the user out', () => {
        mockLoginEnabled = true;

        render(<ManageMenu anchorEl={anchorEl} onClose={onClose} />);

        fireEvent.click(screen.getByRole('menuitem', { name: /logout/i }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockLogout).toHaveBeenCalledTimes(1);
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('hides statistics navigation from visitors when login is enabled', () => {
        mockLoginEnabled = true;
        mockUserRole = 'visitor';

        render(<ManageMenu anchorEl={anchorEl} onClose={onClose} />);

        expect(screen.queryByRole('menuitem', { name: /statisticsTitle/i })).not.toBeInTheDocument();
    });
});
