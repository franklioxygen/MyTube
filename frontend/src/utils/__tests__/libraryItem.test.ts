import { describe, expect, it } from 'vitest';
import { isRemoteVideo, LIBRARY_POLL_MS, libraryPollInterval, remoteInstanceName, videoCan } from '../libraryItem';

const remote = (capabilities: Record<string, boolean>) => ({
    origin: { kind: 'remote' as const, instanceId: 'peer', instanceName: 'NAS' },
    capabilities: capabilities as any,
});

describe('library items', () => {
    it('treats videos without a remote origin as native, with every capability', () => {
        expect(isRemoteVideo({})).toBe(false);
        expect(isRemoteVideo(null)).toBe(false);
        expect(videoCan({}, 'canDelete')).toBe(true);
        expect(videoCan({ origin: { kind: 'local' } }, 'canEdit')).toBe(true);
        expect(remoteInstanceName({})).toBeNull();
    });

    it('lets a remote item do only what the server granted', () => {
        const video = remote({ canPlay: true, canDelete: false });
        expect(isRemoteVideo(video)).toBe(true);
        expect(remoteInstanceName(video)).toBe('NAS');
        expect(videoCan(video, 'canPlay')).toBe(true);
        expect(videoCan(video, 'canDelete')).toBe(false);
        // Anything not granted explicitly is refused.
        expect(videoCan(video, 'canShare')).toBe(false);
        expect(videoCan({ origin: video.origin }, 'canPlay')).toBe(false);
    });

    it('polls the library while remote items are shown or peers may still sync', () => {
        const native = [{}];
        expect(libraryPollInterval(native, false)).toBe(false);
        expect(libraryPollInterval(undefined, false)).toBe(false);
        // A peer was just connected: its first sync has not landed yet.
        expect(libraryPollInterval(native, true)).toBe(LIBRARY_POLL_MS);
        expect(libraryPollInterval([...native, remote({ canPlay: true })], false)).toBe(LIBRARY_POLL_MS);
    });
});
