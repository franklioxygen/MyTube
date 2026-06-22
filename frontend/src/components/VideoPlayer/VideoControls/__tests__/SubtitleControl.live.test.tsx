import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SubtitleControl from '../SubtitleControl';

vi.mock('../../../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const baseProps = {
  subtitles: [] as Array<{ language: string; filename: string; path: string }>,
  subtitlesEnabled: false,
  selectedSubtitleIndices: [] as number[],
  subtitleMenuAnchor: document.createElement('div'),
  onSubtitleClick: vi.fn(),
  onCloseMenu: vi.fn(),
  onSelectSubtitle: vi.fn(),
};

describe('SubtitleControl — live option', () => {
  it('renders a live option (no delete button) when available', () => {
    render(
      <SubtitleControl
        {...baseProps}
        liveSubtitleAvailable
        liveSubtitleLabel="Live (English)"
        liveSubtitleSelected={false}
        onSelectLiveSubtitle={vi.fn()}
      />,
    );
    expect(screen.getByText('Live (English)')).toBeInTheDocument();
    // No file subtitles → no delete buttons anywhere.
    expect(screen.queryByLabelText('delete')).not.toBeInTheDocument();
  });

  it('calls onSelectLiveSubtitle when the live option is clicked', async () => {
    const onSelectLiveSubtitle = vi.fn();
    render(
      <SubtitleControl
        {...baseProps}
        liveSubtitleAvailable
        liveSubtitleLabel="Live (English)"
        liveSubtitleSelected={false}
        onSelectLiveSubtitle={onSelectLiveSubtitle}
      />,
    );
    await userEvent.click(screen.getByText('Live (English)'));
    expect(onSelectLiveSubtitle).toHaveBeenCalled();
  });

  it('allows selecting live when two file subtitles are already selected', async () => {
    const onSelectLiveSubtitle = vi.fn();
    render(
      <SubtitleControl
        {...baseProps}
        subtitles={[
          { language: 'en', filename: 'en.vtt', path: '/subs/en.vtt' },
          { language: 'fr', filename: 'fr.vtt', path: '/subs/fr.vtt' },
        ]}
        selectedSubtitleIndices={[0, 1]}
        liveSubtitleAvailable
        liveSubtitleLabel="Live (English)"
        liveSubtitleSelected={false}
        onSelectLiveSubtitle={onSelectLiveSubtitle}
      />,
    );
    await userEvent.click(screen.getByText('Live (English)'));
    expect(onSelectLiveSubtitle).toHaveBeenCalled();
  });

  it('does not render the live option when unavailable', () => {
    render(<SubtitleControl {...baseProps} liveSubtitleAvailable={false} />);
    expect(screen.queryByText('Live (English)')).not.toBeInTheDocument();
  });
});
