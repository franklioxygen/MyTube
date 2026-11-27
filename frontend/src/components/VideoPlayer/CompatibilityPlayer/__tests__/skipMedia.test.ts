import { describe, expect, it } from 'vitest';
import type { PlaybackSnapshot, PlaybackStatus } from '../playbackEngine';
import { EngineSkipMedia } from '../skipMedia';

const snapshot = (status: PlaybackStatus, currentTime: number): PlaybackSnapshot => ({
    status, currentTime, duration: 100, error: null, pipeline: null, unsupported: false,
    aspectRatio: null, buffering: status === 'buffering', canSeek: true,
});

const record = (media: EngineSkipMedia) => {
    const events: string[] = [];
    for (const type of ['play', 'timeupdate', 'seeked']) {
        media.addEventListener(type, () => events.push(`${type}@${media.currentTime}`));
    }
    return events;
};

describe('EngineSkipMedia', () => {
    it('raises play once on starting, then a timeupdate per playing snapshot', () => {
        const media = new EngineSkipMedia();
        const events = record(media);

        media.update(snapshot('ready', 0));
        media.update(snapshot('playing', 0.2));
        media.update(snapshot('playing', 0.4));
        // Buffering holds the clock: still playing, but nothing new to sample.
        media.update(snapshot('buffering', 0.4));
        media.update(snapshot('paused', 0.4));

        expect(events).toEqual(['play@0.2', 'timeupdate@0.2', 'timeupdate@0.4']);
        expect(media.paused).toBe(true);
    });

    it('reports a reposition as seeking until it ends, and starts a new played run there', () => {
        const media = new EngineSkipMedia();
        const events = record(media);
        media.update(snapshot('playing', 5));

        media.beginSeek();
        expect(media.seeking).toBe(true);
        media.landed(30);
        media.update(snapshot('playing', 30));
        media.endSeek();
        media.update(snapshot('playing', 31));

        expect(media.seeking).toBe(false);
        expect(events.slice(-2)).toEqual(['seeked@30', 'timeupdate@31']);
        expect([media.played.length, media.played.start(0), media.played.end(0)]).toEqual([1, 30, 31]);

        media.reset();
        expect([media.currentTime, media.paused, media.played.start(0)]).toEqual([0, true, 0]);
    });
});
