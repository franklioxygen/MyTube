import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DownloadConfirmModal from '../DownloadConfirmModal';

const mockPersist = vi.fn();
let mockInitialValue = false;

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ data: { audioFormat: 'mp3' } }),
}));
vi.mock('../../hooks/useDownloadAudioOnlyPreference', () => ({
  useDownloadAudioOnlyPreference: () => [mockInitialValue, mockPersist],
}));

describe('DownloadConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialValue = false;
  });

  const renderModal = (isMissAV = false, onConfirm = vi.fn()) => {
    render(
      <ThemeProvider theme={createTheme()}>
        <DownloadConfirmModal
          isOpen
          onClose={vi.fn()}
          videoTitle="Track"
          sourceUrl="https://youtube.com/watch?v=abc"
          onConfirm={onConfirm}
          isMissAV={isMissAV}
        />
      </ThemeProvider>,
    );
    return onConfirm;
  };

  it('keeps the checkbox visible and persists only the confirmed choice', async () => {
    const onConfirm = renderModal();
    const checkbox = screen.getByRole('checkbox', { name: 'downloadAudioOnly' });
    fireEvent.click(checkbox);
    expect(mockPersist).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'download' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ audioOnly: true }));
    expect(mockPersist).toHaveBeenCalledWith(true);
  });

  it('omits audio-only for MissAV links', async () => {
    const onConfirm = renderModal(true);
    expect(screen.queryByRole('checkbox', { name: 'downloadAudioOnly' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'download' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ audioOnly: false }));
    expect(mockPersist).toHaveBeenCalledWith(false);
  });
});
