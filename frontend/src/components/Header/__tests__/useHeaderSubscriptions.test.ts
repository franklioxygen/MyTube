import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHeaderSubscriptions } from '../useHeaderSubscriptions';

const mockGet = vi.fn();
const mockScheduleNonCriticalTask = vi.fn();
const mockCancelScheduledStart = vi.fn();

vi.mock('../../../utils/apiClient', () => ({
    api: {
        get: (...args: any[]) => mockGet(...args),
    },
}));

vi.mock('../../../utils/scheduleNonCriticalTask', () => ({
    scheduleNonCriticalTask: (...args: any[]) => mockScheduleNonCriticalTask(...args),
}));

describe('useHeaderSubscriptions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        mockScheduleNonCriticalTask.mockImplementation((callback: () => void) => {
            callback();
            return mockCancelScheduledStart;
        });
    });

    it('returns false immediately for visitors', () => {
        const { result } = renderHook(() => useHeaderSubscriptions(true));

        expect(result.current).toBe(false);
        expect(mockScheduleNonCriticalTask).not.toHaveBeenCalled();
        expect(mockGet).not.toHaveBeenCalled();
    });

    it('marks subscriptions active when there are saved subscriptions', async () => {
        mockGet
            .mockResolvedValueOnce({ data: [{ id: 'sub-1' }] })
            .mockResolvedValueOnce({ data: [] });

        const { result } = renderHook(() => useHeaderSubscriptions(false));

        await waitFor(() => {
            expect(result.current).toBe(true);
        });

        expect(mockGet).toHaveBeenCalledWith('/subscriptions');
        expect(mockGet).toHaveBeenCalledWith('/subscriptions/tasks');
    });

    it('marks subscriptions active when there are active or paused tasks', async () => {
        mockGet
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [{ status: 'paused' }] });

        const { result } = renderHook(() => useHeaderSubscriptions(false));

        await waitFor(() => {
            expect(result.current).toBe(true);
        });
    });

    it('falls back to false for non-array responses', async () => {
        mockGet
            .mockResolvedValueOnce({ data: { invalid: true } })
            .mockResolvedValueOnce({ data: { invalid: true } });

        const { result } = renderHook(() => useHeaderSubscriptions(false));

        await waitFor(() => {
            expect(result.current).toBe(false);
        });
    });

    it('falls back to false when requests throw synchronously', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockGet.mockImplementation(() => {
            throw new Error('boom');
        });

        const { result } = renderHook(() => useHeaderSubscriptions(false));

        await waitFor(() => {
            expect(result.current).toBe(false);
        });

        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('cleans up the scheduled start and polling interval on unmount', async () => {
        const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
        mockGet
            .mockResolvedValue({ data: [] });

        const { unmount } = renderHook(() => useHeaderSubscriptions(false));

        unmount();

        expect(mockCancelScheduledStart).toHaveBeenCalledTimes(1);
        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

        clearIntervalSpy.mockRestore();
    });
});
