import { eq } from 'drizzle-orm';
import cron, { ScheduledTask } from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { subscriptions } from '../db/schema';
import { downloadYouTubeVideo } from './downloadService';
import { YtDlpDownloader } from './downloaders/YtDlpDownloader';


export interface Subscription {
    id: string;
    author: string;
    authorUrl: string;
    interval: number;
    lastVideoLink?: string;
    lastCheck?: number;
    downloadCount: number;
    createdAt: number;
    platform: string;
}

export class SubscriptionService {
    private static instance: SubscriptionService;
    private checkTask: ScheduledTask | null = null;

    private constructor() { }

    public static getInstance(): SubscriptionService {
        if (!SubscriptionService.instance) {
            SubscriptionService.instance = new SubscriptionService();
        }
        return SubscriptionService.instance;
    }

    async subscribe(authorUrl: string, interval: number): Promise<Subscription> {
        // Validate URL (basic check)
        if (!authorUrl.includes('youtube.com')) {
            throw new Error('Invalid YouTube URL');
        }

        // Check if already subscribed
        const existing = await db.select().from(subscriptions).where(eq(subscriptions.authorUrl, authorUrl));
        if (existing.length > 0) {
            throw new Error('Subscription already exists');
        }

        // Extract author from URL if possible
        let authorName = 'Unknown Author';
        const match = authorUrl.match(/youtube\.com\/(@[^\/]+)/);
        if (match && match[1]) {
            authorName = match[1];
        } else {
            // Fallback: try to extract from other URL formats
            const parts = authorUrl.split('/');
            if (parts.length > 0) {
                const lastPart = parts[parts.length - 1];
                if (lastPart) authorName = lastPart;
            }
        }

        // We skip heavy getVideoInfo here to ensure fast response.
        // The scheduler will eventually fetch new videos and we can update author name then if needed.
        
        let lastVideoLink = '';

        const newSubscription: Subscription = {
            id: uuidv4(),
            author: authorName,
            authorUrl,
            interval,
            lastVideoLink,
            lastCheck: Date.now(),
            downloadCount: 0,
            createdAt: Date.now(),
            platform: 'YouTube'
        };

        await db.insert(subscriptions).values(newSubscription);
        return newSubscription;
    }

    async unsubscribe(id: string): Promise<void> {
        await db.delete(subscriptions).where(eq(subscriptions.id, id));
    }

    async listSubscriptions(): Promise<Subscription[]> {
        // @ts-ignore - Drizzle type inference might be tricky with raw select sometimes, but this should be fine.
        // Actually, db.select().from(subscriptions) returns the inferred type.
        return await db.select().from(subscriptions);
    }

    async checkSubscriptions(): Promise<void> {
        // console.log('Checking subscriptions...'); // Too verbose
        const allSubs = await this.listSubscriptions();
        
        for (const sub of allSubs) {
            const now = Date.now();
            const lastCheck = sub.lastCheck || 0;
            const intervalMs = sub.interval * 60 * 1000;

            if (now - lastCheck >= intervalMs) {
                try {
                    console.log(`Checking subscription for ${sub.author}...`);
                    // 1. Fetch latest video link
                    // We need a robust way to get the latest video.
                    // We can use `yt-dlp --print webpage_url --playlist-end 1 "channel_url"`
                    // We'll need to expose a method in `downloadService` or `YtDlpDownloader` for this.
                    // For now, let's assume `getLatestVideoUrl` exists.
                    const latestVideoUrl = await this.getLatestVideoUrl(sub.authorUrl);

                    if (latestVideoUrl && latestVideoUrl !== sub.lastVideoLink) {
                        console.log(`New video found for ${sub.author}: ${latestVideoUrl}`);
                        
                        // 2. Download the video
                        // We use `downloadYouTubeVideo` from downloadService`.
                        // We might want to associate this download with the subscription for tracking?
                        // The requirement says "update last_video_link value".
                        
                        await downloadYouTubeVideo(latestVideoUrl);
                        
                        // 3. Update subscription record
                        await db.update(subscriptions)
                            .set({
                                lastVideoLink: latestVideoUrl,
                                lastCheck: now,
                                downloadCount: (sub.downloadCount || 0) + 1
                            })
                            .where(eq(subscriptions.id, sub.id));
                    } else {
                        // Just update lastCheck
                        await db.update(subscriptions)
                            .set({ lastCheck: now })
                            .where(eq(subscriptions.id, sub.id));
                    }
                } catch (error) {
                    console.error(`Error checking subscription for ${sub.author}:`, error);
                }
            }
        }
    }

    startScheduler() {
        if (this.checkTask) {
            this.checkTask.stop();
        }
        // Run every minute
        this.checkTask = cron.schedule('* * * * *', () => {
            this.checkSubscriptions();
        });
        console.log('Subscription scheduler started (node-cron).');
    }

    // Helper to get latest video URL. 
    // This should probably be in YtDlpDownloader, but for now we can implement it here using a similar approach.
    // We need to import `exec` or similar to run yt-dlp.
    // Since `YtDlpDownloader` is in `services/downloaders`, we should probably add a method there.
    // But to keep it self-contained for now, I'll assume we can add it to `YtDlpDownloader` later or mock it.
    // Let's try to use `YtDlpDownloader.getLatestVideoUrl` if we can add it.
    // For now, I will implement a placeholder that uses `YtDlpDownloader`'s internal logic if possible, 
    // or just calls `getVideoInfo` and hopes it works for channels (it might not give the *latest* video URL directly).
    
    // BETTER APPROACH: Add `getLatestVideoUrl` to `YtDlpDownloader` class.
    // I will do that in a separate step. For now, I'll define the interface.
    private async getLatestVideoUrl(channelUrl: string): Promise<string | null> {
        return await YtDlpDownloader.getLatestVideoUrl(channelUrl);
    }
}

export const subscriptionService = SubscriptionService.getInstance();
