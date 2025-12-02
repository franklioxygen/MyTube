import { Request, Response } from 'express';
import { subscriptionService } from '../services/subscriptionService';

export const createSubscription = async (req: Request, res: Response) => {
    try {
        const { url, interval } = req.body;
        console.log('Creating subscription:', { url, interval, body: req.body });
        if (!url || !interval) {
            return res.status(400).json({ error: 'URL and interval are required' });
        }
        const subscription = await subscriptionService.subscribe(url, parseInt(interval));
        res.status(201).json(subscription);
    } catch (error: any) {
        console.error('Error creating subscription:', error);
        if (error.message === 'Subscription already exists') {
            return res.status(409).json({ error: 'Subscription already exists' });
        }
        res.status(500).json({ error: error.message || 'Failed to create subscription' });
    }
};

export const getSubscriptions = async (req: Request, res: Response) => {
    try {
        const subscriptions = await subscriptionService.listSubscriptions();
        res.json(subscriptions);
    } catch (error) {
        console.error('Error fetching subscriptions:', error);
        res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
};

export const deleteSubscription = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await subscriptionService.unsubscribe(id);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error deleting subscription:', error);
        res.status(500).json({ error: 'Failed to delete subscription' });
    }
};
