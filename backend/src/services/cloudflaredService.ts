import { ChildProcess, spawn } from 'child_process';
import { logger } from '../utils/logger';

class CloudflaredService {
    private process: ChildProcess | null = null;
    private isRunning: boolean = false;
    private tunnelId: string | null = null;
    private accountTag: string | null = null;
    private publicUrl: string | null = null;

    private parseToken(token: string) {
        try {
            const buffer = Buffer.from(token, 'base64');
            const decoded = JSON.parse(buffer.toString());
            // Token format usually contains: a (account tag), t (tunnel id), s (secret)
            this.accountTag = decoded.a || null;
            this.tunnelId = decoded.t || null;
        } catch (error) {
            logger.error('Failed to parse Cloudflare token', error);
            this.tunnelId = null;
            this.accountTag = null;
        }
    }

    public start(token?: string, port: number = 5551) {
        if (this.isRunning) {
            logger.info('Cloudflared service is already running.');
            if (token) this.parseToken(token);
            return;
        }

        this.publicUrl = null; // Reset URL

        let args: string[] = [];

        if (token) {
            // Named Tunnel
            this.parseToken(token);
            logger.info(`Starting Cloudflared Named Tunnel (ID: ${this.tunnelId})...`);
            args = ['tunnel', 'run', '--token', token];
        } else {
            // Quick Tunnel
            this.tunnelId = null;
            this.accountTag = null;
            logger.info(`Starting Cloudflared Quick Tunnel on port ${port}...`);
            args = ['tunnel', '--url', `http://localhost:${port}`];
        }

        try {
            this.process = spawn('cloudflared', args);

            const handleOutput = (data: Buffer) => {
                const message = data.toString();
                // Simple logging
                logger.debug(`Cloudflared: ${message}`);

                // Capture Quick Tunnel URL
                // Example line: 2023-10-27T10:00:00Z INF |  https://random-name.trycloudflare.com  |
                const urlMatch = message.match(/https?:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                if (urlMatch) {
                    this.publicUrl = urlMatch[0];
                    logger.info(`Cloudflared Quick Tunnel URL: ${this.publicUrl}`);
                }
            };

            this.process.stdout?.on('data', handleOutput);
            this.process.stderr?.on('data', handleOutput); // Cloudflared often logs to stderr

            this.process.on('close', (code) => {
                logger.info(`Cloudflared exited with code ${code}`);
                this.isRunning = false;
                this.process = null;
                this.publicUrl = null;
            });

            this.process.on('error', (err) => {
                logger.error('Failed to start Cloudflared process:', err);
                this.isRunning = false;
                this.process = null;
                this.publicUrl = null;
            });

            this.isRunning = true;
            logger.info('Cloudflared process spawned.');
        } catch (error) {
            logger.error('Error spawning cloudflared:', error);
        }
    }

    public stop() {
        if (this.process) {
            logger.info('Stopping Cloudflared tunnel...');
            this.process.kill();
            this.process = null;
            this.isRunning = false;
            this.publicUrl = null;
            logger.info('Cloudflared tunnel stopped.');
        } else {
            logger.info('No Cloudflared process is running to stop.');
        }
    }

    public restart(token?: string, port: number = 5551) {
        logger.info('Restarting Cloudflared tunnel...');
        this.stop();
        setTimeout(() => {
            this.start(token, port);
        }, 1000); // Wait a second before restarting
    }

    public getStatus() {
        return {
            isRunning: this.isRunning,
            tunnelId: this.tunnelId,
            accountTag: this.accountTag,
            publicUrl: this.publicUrl
        };
    }
}

export const cloudflaredService = new CloudflaredService();
