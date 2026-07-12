import { useCallback, useRef, useState } from 'react';

export function useAsyncAction<A extends unknown[]>(
    action: (...args: A) => Promise<unknown>
): { run: (...args: A) => Promise<void>; pending: boolean } {
    const [pending, setPending] = useState(false);
    const inFlight = useRef(false);

    const run = useCallback(
        async (...args: A) => {
            if (inFlight.current) {
                return;
            }

            inFlight.current = true;
            setPending(true);

            try {
                await action(...args);
            } finally {
                inFlight.current = false;
                setPending(false);
            }
        },
        [action]
    );

    return { run, pending };
}
