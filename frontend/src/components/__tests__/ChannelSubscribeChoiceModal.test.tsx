import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChannelSubscribeChoiceModal from '../ChannelSubscribeChoiceModal';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('ChannelSubscribeChoiceModal', () => {
    const onClose = vi.fn();
    const onChooseVideos = vi.fn();
    const onChoosePlaylists = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('leaves closing to the selected subscription flow', async () => {
        const user = userEvent.setup();
        render(
            <ChannelSubscribeChoiceModal
                open
                onClose={onClose}
                onChooseVideos={onChooseVideos}
                onChoosePlaylists={onChoosePlaylists}
            />
        );

        await user.click(screen.getByRole('button', { name: 'subscribeAllVideos' }));

        expect(onChooseVideos).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });
});
