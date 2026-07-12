import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsyncAction } from '../useAsyncAction';

const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    return { promise, resolve, reject };
};

describe('useAsyncAction', () => {
    it('sets pending while the action is in flight and clears after resolve', async () => {
        const request = deferred();
        const action = vi.fn((id: string) => {
            String(id);
            return request.promise;
        });
        const { result } = renderHook(() => useAsyncAction(action));

        act(() => {
            void result.current.run('video-1');
        });

        expect(action).toHaveBeenCalledWith('video-1');
        expect(result.current.pending).toBe(true);

        await act(async () => {
            request.resolve();
            await request.promise;
        });

        await waitFor(() => expect(result.current.pending).toBe(false));
    });

    it('clears pending after reject', async () => {
        const request = deferred();
        const action = vi.fn(() => request.promise);
        const { result } = renderHook(() => useAsyncAction(action));

        let runPromise!: Promise<void>;
        act(() => {
            runPromise = result.current.run();
        });

        await act(async () => {
            request.reject(new Error('failed'));
            await expect(runPromise).rejects.toThrow('failed');
        });

        await waitFor(() => expect(result.current.pending).toBe(false));
    });

    it('ignores overlapping invocations while one action is pending', async () => {
        const request = deferred();
        const action = vi.fn((id: string) => {
            String(id);
            return request.promise;
        });
        const { result } = renderHook(() => useAsyncAction(action));

        act(() => {
            void result.current.run('first');
            void result.current.run('second');
        });

        expect(action).toHaveBeenCalledTimes(1);
        expect(action).toHaveBeenCalledWith('first');

        await act(async () => {
            request.resolve();
            await request.promise;
        });
    });
});
