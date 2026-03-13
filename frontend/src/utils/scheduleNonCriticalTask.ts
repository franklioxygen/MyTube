type IdleCallbackHandle = {
    requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
};

interface ScheduleNonCriticalTaskOptions {
    timeout?: number;
    fallbackDelay?: number;
}

export const scheduleNonCriticalTask = (
    callback: () => void,
    {
        timeout = 4000,
        fallbackDelay = 1500,
    }: ScheduleNonCriticalTaskOptions = {},
) => {
    if (typeof window === 'undefined') {
        callback();
        return () => undefined;
    }

    const idleWindow = window as typeof window & IdleCallbackHandle;

    if (typeof idleWindow.requestIdleCallback === 'function') {
        const idleCallbackId = idleWindow.requestIdleCallback(
            () => callback(),
            { timeout },
        );

        return () => {
            idleWindow.cancelIdleCallback?.(idleCallbackId);
        };
    }

    const timeoutId = window.setTimeout(callback, fallbackDelay);
    return () => {
        window.clearTimeout(timeoutId);
    };
};
