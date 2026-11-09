import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { useState } from 'react';
import type { DanmakuTrack } from '../../../utils/danmaku';
import { isOverlayTarget } from '../../../utils/keyboardShortcutGuards';
import DanmakuPlayer from '../DanmakuPlayer';
import { api } from '../../../utils/apiClient';
const role = vi.hoisted(() => ({ value: 'admin' }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ userRole: role.value }) }));
vi.mock('../../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('../../../utils/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../DanmakuOverlay', () => ({ default: ({ events, getTime, offset, opacity }: { events: Array<{ text: string }>; getTime: () => number; offset: number; opacity: number }) =>
    <div data-testid="danmaku-overlay" data-offset={offset} data-opacity={opacity}>{events.map(event => event.text).join(',')} at {getTime()}</div> }));
const track = { status: 'ready', loading: false, revision: 'first', eventCount: 1, ignoredCount: 0 };
let currentTrack: DanmakuTrack;
const response = (data: unknown): AxiosResponse => ({ data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } });
const NARROW = '(max-width:599.95px)';
const SHORT = '(max-height: 500px)';
const TOUCH = '(hover: none), (pointer: coarse)';
function matchViewport(...matching: string[]) {
    vi.mocked(window.matchMedia).mockImplementation(query => ({
        matches: matching.includes(query), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
}
beforeEach(() => {
    vi.resetAllMocks(); role.value = 'admin'; localStorage.clear(); sessionStorage.clear(); currentTrack = { ...track, status: 'ready' };
    matchViewport();
    vi.mocked(api.get).mockImplementation(async url => ({ data: String(url).endsWith('/events') ? { events: [{ time: 1, text: 'Saved comment', mode: 'scroll', color: '#fff', fontSize: 25 }] } : currentTrack }) as never);
    vi.mocked(api.post).mockResolvedValue(response({ ...track, revision: 'next' }));
    vi.mocked(api.delete).mockResolvedValue(response({ status: 'none', loading: false, eventCount: 0, ignoredCount: 0 }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});
function Harness() {
    const [picture, setPicture] = useState<HTMLDivElement | null>(null);
    return <><div ref={setPicture} data-testid="picture" /><div data-testid="controls">
        <DanmakuPlayer videoId="video" getTime={() => 3} overlayContainer={picture} canRefresh />
    </div></>;
}
function show() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
}
async function open() {
    fireEvent.click(screen.getByRole('button', { name: 'danmaku' }));
    await screen.findByText(/danmakuReady/);
}
describe('danmaku controls', () => {
    it('loads only metadata until enabled and immediately removes the overlay when disabled', async () => {
        show(); await open();
        expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/events'));
        fireEvent.click(screen.getByRole('switch'));
        expect(await screen.findByTestId('danmaku-overlay')).toHaveTextContent('Saved comment at 3');
        expect(screen.getByTestId('picture')).toContainElement(screen.getByTestId('danmaku-overlay'));
        expect(screen.getByTestId('controls')).toContainElement(screen.getByRole('button', { name: 'danmaku', hidden: true }));
        fireEvent.click(screen.getByRole('switch'));
        expect(screen.queryByTestId('danmaku-overlay')).not.toBeInTheDocument();
        expect(localStorage.getItem('danmakuEnabled')).toBe('false');
    });
    it('offers loading a missing track and enables it on success without downloading the video', async () => {
        currentTrack = { status: 'none', loading: false, eventCount: 0, ignoredCount: 0 };
        vi.mocked(api.post).mockImplementationOnce(async () => {
            currentTrack = { ...track, status: 'ready' };
            return response(currentTrack);
        });
        show();
        fireEvent.click(screen.getByRole('button', { name: 'danmaku' }));
        fireEvent.click(await screen.findByRole('button', { name: 'danmakuLoad' }));
        expect(await screen.findByTestId('danmaku-overlay')).toHaveTextContent('Saved comment');
        expect(api.post).toHaveBeenCalledWith('/videos/video/danmaku/refresh', undefined, expect.any(Object));
        expect(localStorage.getItem('danmakuEnabled')).toBe('true');
        expect(screen.queryByRole('button', { name: 'danmakuLoad' })).not.toBeInTheDocument();
    });
    it('imports an XML attachment without calling any media-download endpoint', async () => {
        show(); await open();
        const file = new File(['<i/>'], 'sample.xml', { type: 'text/xml' });
        fireEvent.change(screen.getByLabelText('danmakuImport', { selector: 'input' }), { target: { files: [file] } });
        await waitFor(() => expect(api.post).toHaveBeenCalled());
        const [url, form] = vi.mocked(api.post).mock.calls[0];
        expect(url).toBe('/videos/video/danmaku');
        expect((form as FormData).get('danmaku')).toBe(file);
    });
    it('requires replacement confirmation before fetching a new track', async () => {
        show(); await open();
        vi.mocked(window.confirm).mockReturnValueOnce(false);
        fireEvent.click(screen.getByRole('button', { name: 'danmakuRefresh' }));
        expect(api.post).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'danmakuRefresh' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('/videos/video/danmaku/refresh', undefined, expect.any(Object)));
    });
    it('keeps an available overlay when attachment refresh fails', async () => {
        localStorage.setItem('danmakuEnabled', 'true');
        vi.mocked(api.post).mockRejectedValueOnce(new Error('HTTP 412'));
        show(); await open(); await screen.findByTestId('danmaku-overlay');
        fireEvent.click(screen.getByRole('button', { name: 'danmakuRefresh' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('danmakuOperationFailed');
        expect(screen.getByTestId('danmaku-overlay')).toBeInTheDocument();
    });
    it('shows viewing controls to visitors while withholding track mutations', async () => {
        role.value = 'visitor'; show(); await open();
        expect(screen.getByRole('switch')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'danmakuImport' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'danmakuRefresh' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'danmakuDelete' })).not.toBeInTheDocument();
    });
    it('keeps a popover anchored to the button on a desktop viewport', async () => {
        show(); await open();
        expect(screen.getByRole('dialog', { name: 'danmaku' }).closest('.MuiPopover-root')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'close' })).not.toBeInTheDocument();
    });
    it('uses a closable bottom sheet on a phone in portrait', async () => {
        matchViewport(NARROW, TOUCH);
        show(); await open();
        expect(screen.getByRole('dialog', { name: 'danmaku' })).toHaveClass('MuiDrawer-paperAnchorBottom');
        expect(document.querySelector('.MuiBackdrop-root')).not.toHaveClass('MuiBackdrop-invisible');
        fireEvent.click(screen.getByRole('button', { name: 'close' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
    it('moves the sheet beside the picture on a phone in landscape', async () => {
        matchViewport(SHORT, TOUCH);
        show(); await open();
        expect(screen.getByRole('dialog', { name: 'danmaku' })).toHaveClass('MuiDrawer-paperAnchorRight');
        expect(document.querySelector('.MuiBackdrop-root')).not.toHaveClass('MuiBackdrop-invisible');
    });
    it('keeps a popover on a short window driven by a mouse', async () => {
        matchViewport(SHORT);
        show(); await open();
        expect(screen.getByRole('dialog', { name: 'danmaku' }).closest('.MuiPopover-root')).toBeInTheDocument();
    });
    it('owns the keyboard while open so player shortcuts do not fire from its buttons', async () => {
        show(); await open();
        const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
        screen.getByRole('button', { name: 'danmakuImport' }).dispatchEvent(event);
        expect(isOverlayTarget(event)).toBe(true);
    });
    it('hides display controls until a track has comments to adjust', async () => {
        currentTrack = { status: 'empty', loading: false, revision: 'first', eventCount: 0, ignoredCount: 0 };
        show();
        fireEvent.click(screen.getByRole('button', { name: 'danmaku' }));
        await screen.findByText(/danmakuEmpty/);
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
        expect(screen.queryByText('danmakuExternalNotice')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'danmakuImport' })).toBeInTheDocument();
    });
    it('disables display controls while danmaku is off', async () => {
        show(); await open();
        expect(screen.getByRole('slider')).toBeDisabled();
        expect(screen.getByRole('spinbutton')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'danmakuOffset +0.5' })).toBeDisabled();
        fireEvent.click(screen.getByRole('switch'));
        expect(screen.getByRole('slider')).toBeEnabled();
        expect(screen.getByRole('spinbutton')).toBeEnabled();
        expect(screen.getByRole('button', { name: 'danmakuOffset +0.5' })).toBeEnabled();
    });
    it('steps the offset, accepts typed negatives and stays within bounds', async () => {
        localStorage.setItem('danmakuEnabled', 'true');
        show(); await open();
        const overlay = await screen.findByTestId('danmaku-overlay');
        const field = screen.getByRole('spinbutton');
        fireEvent.click(screen.getByRole('button', { name: 'danmakuOffset -0.5' }));
        expect(overlay).toHaveAttribute('data-offset', '-0.5');
        // A number input reports a half-typed "-" as empty: that must not reset the value being typed.
        fireEvent.change(field, { target: { value: '' } });
        expect(field).toHaveValue(null);
        expect(overlay).toHaveAttribute('data-offset', '-0.5');
        fireEvent.change(field, { target: { value: '-12' } });
        expect(overlay).toHaveAttribute('data-offset', '-12');
        fireEvent.change(field, { target: { value: '9999' } });
        expect(overlay).toHaveAttribute('data-offset', '3600');
        fireEvent.blur(field);
        expect(field).toHaveValue(3600);
        expect(screen.getByRole('button', { name: 'danmakuOffset +0.5' })).toBeDisabled();
    });
    it('restores opacity and offset after a remount, as rotating across the mobile breakpoint causes', async () => {
        localStorage.setItem('danmakuEnabled', 'true');
        const view = show(); await open();
        await screen.findByTestId('danmaku-overlay');
        fireEvent.click(screen.getByRole('button', { name: 'danmakuOffset +0.5' }));
        fireEvent.change(screen.getByRole('slider'), { target: { value: 0.5 } });
        view.unmount();
        show(); await open();
        const overlay = await screen.findByTestId('danmaku-overlay');
        expect(overlay).toHaveAttribute('data-offset', '0.5');
        expect(overlay).toHaveAttribute('data-opacity', '0.5');
        expect(screen.getByRole('spinbutton')).toHaveValue(0.5);
        expect(screen.getByRole('slider')).toHaveValue('0.5');
    });
    it('ignores another video\'s offset and unusable stored values', async () => {
        localStorage.setItem('danmakuEnabled', 'true');
        localStorage.setItem('danmakuOpacity', '5');
        sessionStorage.setItem('danmakuOffset:video', 'not a number');
        sessionStorage.setItem('danmakuOffset:other', '12');
        show(); await open();
        const overlay = await screen.findByTestId('danmaku-overlay');
        expect(overlay).toHaveAttribute('data-offset', '0');
        expect(overlay).toHaveAttribute('data-opacity', '0.8');
    });
    it('clamps a stored offset to the allowed range', async () => {
        localStorage.setItem('danmakuEnabled', 'true');
        sessionStorage.setItem('danmakuOffset:video', '99999');
        show(); await open();
        expect(await screen.findByTestId('danmaku-overlay')).toHaveAttribute('data-offset', '3600');
    });
});
