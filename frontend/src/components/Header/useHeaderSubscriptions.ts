import { useEffect, useState } from 'react';

import { api } from '../../utils/apiClient';
import { scheduleNonCriticalTask } from '../../utils/scheduleNonCriticalTask';

interface SubscriptionTask {
    status?: string;
}

const hasActiveTask = (tasks: SubscriptionTask[]): boolean => {
    return tasks.some((task) => task.status === 'active' || task.status === 'paused');
};

export const useHeaderSubscriptions = (isVisitor: boolean): boolean => {
    const [hasActiveSubscriptions, setHasActiveSubscriptions] = useState(false);

    useEffect(() => {
        if (isVisitor) {
            setHasActiveSubscriptions(false);
            return;
        }

        let isActive = true;
        let intervalId: number | undefined;

        const checkActiveSubscriptions = async () => {
            try {
                const [subscriptionsRes, tasksRes] = await Promise.all([
                    api.get('/subscriptions').catch(() => ({ data: [] })),
                    api.get('/subscriptions/tasks').catch(() => ({ data: [] }))
                ]);

                const subscriptions = Array.isArray(subscriptionsRes.data) ? subscriptionsRes.data : [];
                const tasks = Array.isArray(tasksRes.data) ? tasksRes.data : [];
                if (isActive) {
                    setHasActiveSubscriptions(subscriptions.length > 0 || hasActiveTask(tasks));
                }
            } catch (error) {
                console.error('Error checking subscriptions:', error);
                if (isActive) {
                    setHasActiveSubscriptions(false);
                }
            }
        };

        const cancelScheduledStart = scheduleNonCriticalTask(() => {
            void checkActiveSubscriptions();
            intervalId = window.setInterval(() => {
                void checkActiveSubscriptions();
            }, 30000);
        });

        return () => {
            isActive = false;
            cancelScheduledStart();
            if (intervalId !== undefined) {
                window.clearInterval(intervalId);
            }
        };
    }, [isVisitor]);

    return hasActiveSubscriptions;
};
