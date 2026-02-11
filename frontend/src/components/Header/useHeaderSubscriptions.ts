import { useEffect, useState } from 'react';

import { api } from '../../utils/apiClient';

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

        const checkActiveSubscriptions = async () => {
            try {
                const [subscriptionsRes, tasksRes] = await Promise.all([
                    api.get('/subscriptions').catch(() => ({ data: [] })),
                    api.get('/subscriptions/tasks').catch(() => ({ data: [] }))
                ]);

                const subscriptions = Array.isArray(subscriptionsRes.data) ? subscriptionsRes.data : [];
                const tasks = Array.isArray(tasksRes.data) ? tasksRes.data : [];
                setHasActiveSubscriptions(subscriptions.length > 0 || hasActiveTask(tasks));
            } catch (error) {
                console.error('Error checking subscriptions:', error);
                setHasActiveSubscriptions(false);
            }
        };

        checkActiveSubscriptions();
        const interval = setInterval(checkActiveSubscriptions, 30000);

        return () => {
            clearInterval(interval);
        };
    }, [isVisitor]);

    return hasActiveSubscriptions;
};
