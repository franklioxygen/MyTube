import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoSelection } from '../useVideoSelection';

const mocks = vi.hoisted(() => ({ role: 'admin' as string | null, loginRequired: true, checking: false, snackbar: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ userRole: mocks.role, loginRequired: mocks.loginRequired, checkingAuth: mocks.checking }) }));
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('../../contexts/SnackbarContext', () => ({ useSnackbar: () => ({ showSnackbar: mocks.snackbar }) }));

const videos = ['a', 'b', 'c'].map((id) => ({ id }));
beforeEach(() => { mocks.role = 'admin'; mocks.loginRequired = true; mocks.checking = false; mocks.snackbar.mockClear(); });

describe('video selection state', () => {
    it('preserves cross-page choices and deselects only the current page', () => {
        const { result } = renderHook(() => useVideoSelection({ scopeKey: 'all', videos }));
        act(() => result.current.togglePage(['a', 'b']));
        act(() => result.current.togglePage(['b', 'c']));
        expect([...result.current.selectedIds]).toEqual(['a', 'b', 'c']);
        act(() => result.current.togglePage(['a', 'b']));
        expect([...result.current.selectedIds]).toEqual(['c']);
    });
    it('clears choices immediately on filter changes but keeps selection mode; changing views exits it', () => {
        const { result, rerender } = renderHook(({ filter, mode }) => useVideoSelection({ scopeKey: filter, modeScopeKey: mode, videos }), {
            initialProps: { filter: 'all', mode: 'home' },
        });
        act(() => result.current.toggle('a'));
        rerender({ filter: 'tag=music', mode: 'home' });
        expect(result.current.selectedIds.size).toBe(0);
        expect(result.current.active).toBe(true);
        rerender({ filter: 'all', mode: 'home' });
        expect(result.current.selectedIds.size).toBe(0);
        rerender({ filter: 'tag=music', mode: 'history' });
        expect(result.current.active).toBe(false);
    });
    it('does not lose selections during temporary loading, and hides deleted items after a confirmed refresh', () => {
        const { result, rerender } = renderHook(({ rows, ready }) => useVideoSelection({ scopeKey: 'all', videos: rows, libraryReady: ready }), {
            initialProps: { rows: videos, ready: true },
        });
        act(() => result.current.togglePage(['a', 'b']));
        rerender({ rows: [], ready: false });
        expect(result.current.selectedIds.size).toBe(2);
        rerender({ rows: [videos[0]], ready: true });
        expect([...result.current.selectedIds]).toEqual(['a']);
        rerender({ rows: videos, ready: true });
        expect([...result.current.selectedIds]).toEqual(['a']);
    });
    it('enforces 500 atomically without silently selecting part of a page', () => {
        const rows = Array.from({ length: 501 }, (_, i) => ({ id: String(i) }));
        const { result } = renderHook(() => useVideoSelection({ scopeKey: 'all', videos: rows }));
        act(() => result.current.togglePage(rows.map((row) => row.id)));
        expect(result.current.selectedIds.size).toBe(0);
        act(() => result.current.togglePage(rows.slice(0, 500).map((row) => row.id)));
        act(() => result.current.toggle('500'));
        expect(result.current.selectedIds.size).toBe(500);
        expect(mocks.snackbar).toHaveBeenCalledWith('bulkSelectionLimit', 'warning');
    });
    it('locks toggles and clearing while a dialog owns a snapshot', () => {
        const { result } = renderHook(() => useVideoSelection({ scopeKey: 'all', videos }));
        act(() => result.current.toggle('a'));
        act(() => result.current.setLocked(true));
        act(() => { result.current.toggle('b'); result.current.clear(); result.current.exit(); });
        expect([...result.current.selectedIds]).toEqual(['a']);
        act(() => result.current.setLocked(false));
        act(() => result.current.toggle('b'));
        expect([...result.current.selectedIds]).toEqual(['a', 'b']);
    });
    it('keeps toggle callbacks stable across unrelated selections and handles rapid toggles', () => {
        const { result } = renderHook(() => useVideoSelection({ scopeKey: 'all', videos }));
        const toggle = result.current.toggle;
        act(() => { toggle('a'); toggle('b'); toggle('a'); });
        expect([...result.current.selectedIds]).toEqual(['b']);
        expect(result.current.toggle).toBe(toggle);
    });
    it('clears exposed choices when access is lost and permits login-disabled management', () => {
        const { result, rerender } = renderHook(() => useVideoSelection({ scopeKey: 'all', videos }));
        act(() => result.current.toggle('a'));
        mocks.role = 'visitor'; rerender();
        expect(result.current.canWrite).toBe(false);
        expect(result.current.selectedIds.size).toBe(0);
        mocks.role = null; mocks.loginRequired = false; rerender();
        expect(result.current.canWrite).toBe(true);
        act(() => result.current.toggle('b'));
        expect([...result.current.selectedIds]).toEqual(['b']);
        mocks.checking = true; rerender();
        expect(result.current.canWrite).toBe(false);
    });
});
