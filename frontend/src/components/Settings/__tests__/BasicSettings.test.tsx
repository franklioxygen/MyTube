import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BasicSettings from '../BasicSettings';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: 'admin' }),
}));

describe('BasicSettings', () => {
    const onChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the audio download button toggle enabled by default', () => {
        render(<BasicSettings language="en" onChange={onChange} />);

        expect(screen.getByRole('switch', { name: 'showAudioDownloadButton' })).toBeChecked();
    });

    it('persists changes to the audio download button toggle', async () => {
        const user = userEvent.setup();
        render(
            <BasicSettings
                language="en"
                showAudioDownloadButton={true}
                onChange={onChange}
            />,
        );

        await user.click(screen.getByRole('switch', { name: 'showAudioDownloadButton' }));

        expect(onChange).toHaveBeenCalledWith('showAudioDownloadButton', false);
    });
});
