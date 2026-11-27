import type { SkipMedia } from '../VideoControls/hooks/useSponsorSkip';
import type { PlaybackSnapshot } from './playbackEngine';

/**
 * D Mode has no media element, so SponsorBlock skipping reads this stand-in
 * instead (issue #555). The player feeds it the engine's snapshots and brackets
 * its own repositioning with beginSeek / endSeek; it raises `timeupdate`,
 * `play` and `seeked` the way a media element would.
 */
export class EngineSkipMedia extends EventTarget implements SkipMedia {
    currentTime = 0;
    seeking = false;
    paused = true;
    readonly playbackRate = 1;
    /** Where the current stretch of uninterrupted playback began. */
    private runStart = 0;

    get played(): Pick<TimeRanges, 'length' | 'start' | 'end'> {
        const start = this.runStart;
        const end = this.currentTime;
        return { length: end >= start ? 1 : 0, start: () => start, end: () => end };
    }

    /** Another source: nothing has played yet. */
    reset(): void {
        this.currentTime = 0;
        this.seeking = false;
        this.paused = true;
        this.runStart = 0;
    }

    /** Every engine snapshot; the engine sends one about every 200 ms while playing. */
    update(snapshot: PlaybackSnapshot): void {
        const playing = snapshot.status === 'playing' || snapshot.status === 'buffering';
        const started = playing && this.paused;
        this.currentTime = snapshot.currentTime;
        this.paused = !playing;
        if (started) this.dispatchEvent(new Event('play'));
        if (snapshot.status === 'playing') this.dispatchEvent(new Event('timeupdate'));
    }

    /** The engine's own report of where a reposition put the playhead. */
    landed(currentTime: number): void {
        this.currentTime = currentTime;
        this.runStart = currentTime;
    }

    beginSeek(): void {
        this.seeking = true;
    }

    endSeek(): void {
        this.seeking = false;
        this.dispatchEvent(new Event('seeked'));
    }
}
