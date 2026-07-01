import { useEffect, useRef } from 'react';
import { api } from '../utils/apiClient';

interface PollableJob {
    id: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    processed: number;
    total: number;
}

/**
 * Polls a long-running settings job (batch rename, media-server export) while
 * its status is 'running', writing each snapshot back via setJob. Polls fast
 * (1s) through the first quarter of the job, then backs off to 3s; errors are
 * silently retried on the slow cadence. Pass stable references (module-scope
 * buildJobUrl, setState setters, useCallback for onCompleted) so the effect
 * only re-arms when the job id/status actually changes.
 */
export function useSettingsJobPolling<T extends PollableJob>(
    job: T | null,
    buildJobUrl: (jobId: string) => string,
    setJob: (job: T) => void,
    onCompleted?: (job: T) => void
): void {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const jobId = job?.id;
    const jobStatus = job?.status;

    useEffect(() => {
        if (!jobId || jobStatus !== 'running') {
            if (timerRef.current) clearTimeout(timerRef.current);
            return;
        }
        const poll = async () => {
            try {
                const res = await api.get<T>(buildJobUrl(jobId));
                setJob(res.data);
                if (res.data.status === 'completed') {
                    onCompleted?.(res.data);
                }
                if (res.data.status === 'running') {
                    const delay = res.data.processed < res.data.total * 0.25 ? 1000 : 3000;
                    timerRef.current = setTimeout(poll, delay);
                }
            } catch {
                // Transient fetch failure: keep polling on the slow cadence.
                timerRef.current = setTimeout(poll, 3000);
            }
        };
        timerRef.current = setTimeout(poll, 1000);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [jobId, jobStatus, buildJobUrl, setJob, onCompleted]);
}
