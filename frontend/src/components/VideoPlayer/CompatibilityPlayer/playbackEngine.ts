/**
 * Compatibility-mode playback engine.
 *
 * Plays a video without any media element: the container is demuxed in JS,
 * frames are decoded with WebCodecs and painted into a `<canvas>`, and audio is
 * decoded into `AudioBuffer`s scheduled on a Web Audio graph. The DOM therefore
 * never contains a `<video>`, `<audio>`, `<source>` or `<track>` node, and no
 * MediaSource is created — nothing the browser recognises as a video player.
 *
 * Framework-free on purpose so the pipeline can be reasoned about (and tested)
 * without React in the way.
 */

import { createDemuxer } from '../../../utils/compatibilityMode/createDemuxer';
import {
    MediaDemuxer,
    UnsupportedMediaError,
} from '../../../utils/compatibilityMode/types';

export type PlaybackStatus =
    | 'idle'
    | 'loading'
    | 'ready'
    | 'playing'
    /** Playing, but the clock is frozen while the queues refill. */
    | 'buffering'
    | 'paused'
    | 'ended'
    | 'error';

export interface PlaybackSnapshot {
    status: PlaybackStatus;
    /** Seconds. */
    currentTime: number;
    /** Seconds, or null when the container does not state a duration. */
    duration: number | null;
    error: string | null;
    /** Human-readable description of the decode path. */
    pipeline: string | null;
    /** True when the failure means the file itself cannot be decoded here. */
    unsupported: boolean;
    /** Decoded frame aspect ratio, once a frame has arrived. */
    aspectRatio: number | null;
    volume: number;
    muted: boolean;
    /** True when playback stalled waiting for data rather than for the user. */
    buffering: boolean;
}

interface QueuedAudio {
    /** Media time in seconds. */
    time: number;
    buffer: AudioBuffer;
}

const MAX_QUEUED_FRAMES = 16;
const MAX_QUEUED_AUDIO = 96;
const MAX_VIDEO_DECODE_QUEUE = 24;
/** Seconds of demuxed media to stay ahead of the playhead. */
const LOOKAHEAD_SECONDS = 4;
/** Seconds of audio handed to Web Audio ahead of the playhead. */
const AUDIO_SCHEDULE_AHEAD = 1;
/** Head start given to the audio clock so the first buffers are not late. */
const AUDIO_START_LEAD = 0.08;
/** Audio older than this relative to the clock is dropped rather than crammed in. */
const AUDIO_LATE_TOLERANCE = 0.05;
const SNAPSHOT_INTERVAL_MS = 200;
const MAX_AUDIO_DECODE_QUEUE = 48;
/** Demuxed less than this far past the playhead counts as a stall. */
const STARVE_MARGIN_SECONDS = 0.1;
/**
 * How much decoded output must be queued before playback resumes after a stall.
 * Expressed in queued items rather than seconds so the target stays reachable
 * within the queue caps above, whatever the frame rate.
 */
const REBUFFER_FRAMES = 8;
const REBUFFER_AUDIO_CHUNKS = 12;
/**
 * How long to wait for a blocked `AudioContext` to start. Autoplay policy can
 * leave `resume()` pending indefinitely, resolve it with the context still
 * suspended, or reject it, depending on the engine — so the outcome is decided
 * by the context's own state after a bounded wait, never by the promise.
 */
const AUDIO_START_TIMEOUT_MS = 1500;
/** Decoder errors tolerated per track before playback is declared dead. */
const MAX_DECODER_RECOVERIES = 3;

/** Pick the first codec string the platform actually accepts. */
const resolveVideoConfig = async (
    config: VideoDecoderConfig,
    fallbacks: string[]
): Promise<VideoDecoderConfig | null> => {
    for (const codec of [config.codec, ...fallbacks]) {
        const candidate = { ...config, codec };
        try {
            const support = await VideoDecoder.isConfigSupported(candidate);
            if (support.supported) {
                return (support.config as VideoDecoderConfig) ?? candidate;
            }
        } catch {
            // Malformed codec strings reject; just try the next candidate.
        }
    }
    return null;
};

const isAudioConfigSupported = async (
    config: AudioDecoderConfig
): Promise<boolean> => {
    try {
        const support = await AudioDecoder.isConfigSupported(config);
        return support.supported === true;
    } catch {
        return false;
    }
};

export interface PlaybackEngineOptions {
    onChange: (snapshot: PlaybackSnapshot) => void;
    onEnded?: () => void;
}

export class CompatibilityPlaybackEngine {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D | null;
    private readonly options: PlaybackEngineOptions;
    private readonly abortController = new AbortController();

    private demuxer: MediaDemuxer | null = null;
    private videoDecoder: VideoDecoder | null = null;
    private audioDecoder: AudioDecoder | null = null;
    private audioContext: AudioContext | null = null;
    private gain: GainNode | null = null;

    private readonly frameQueue: VideoFrame[] = [];
    private readonly audioQueue: QueuedAudio[] = [];
    private readonly liveSources = new Set<AudioBufferSourceNode>();

    private status: PlaybackStatus = 'idle';
    private durationSeconds: number | null = null;
    private errorMessage: string | null = null;
    private unsupported = false;
    private pipeline: string | null = null;

    private videoConfig: VideoDecoderConfig | null = null;
    private audioConfig: AudioDecoderConfig | null = null;
    private videoRecoveries = 0;
    private audioRecoveries = 0;
    private aspectRatio: number | null = null;
    private volume = 1;
    private muted = false;

    private originUs = 0;
    private lastPacketTime = 0;
    private audioBaseTime: number | null = null;
    private wallBaseMs = 0;
    private pausedMediaTime = 0;
    private lastDrawnTime = 0;

    private rafHandle: number | null = null;
    private snapshotTimer: number | null = null;
    private pumping = false;
    private demuxEnded = false;
    private flushed = false;
    private awaitingKeyframe = true;
    private destroyed = false;

    constructor(canvas: HTMLCanvasElement, options: PlaybackEngineOptions) {
        this.canvas = canvas;
        this.context = canvas.getContext('2d');
        this.options = options;
    }

    // ---------------------------------------------------------------- lifecycle

    async load(src: string): Promise<void> {
        this.setStatus('loading');
        try {
            const demuxer = await createDemuxer(src, {
                signal: this.abortController.signal,
            });
            if (this.destroyed) {
                await demuxer.close();
                return;
            }
            this.demuxer = demuxer;
            this.durationSeconds = demuxer.durationUs
                ? demuxer.durationUs / 1e6
                : null;
            // The container knows the exact first presentation time; the first
            // packet in file order does not, whenever B-frames reorder it.
            this.originUs = demuxer.startTimeUs;

            // Every track the container offers must be decodable. Degraded
            // playback (audio over a black canvas, or silent video) is not an
            // acceptable outcome on a display that has no other player.
            if (demuxer.unsupportedTracks.length > 0) {
                throw new UnsupportedMediaError(
                    `Unsupported track in this file: ${demuxer.unsupportedTracks.join(', ')}`
                );
            }

            const labels: string[] = [demuxer.container.toUpperCase()];
            await this.setUpVideo(demuxer, labels);
            await this.setUpAudio(demuxer, labels);

            if (!this.videoDecoder && !this.audioDecoder) {
                throw new UnsupportedMediaError(
                    'This file contains no decodable video or audio track'
                );
            }

            this.pipeline = labels.join(' · ');
            this.setStatus('ready');
            void this.pump();
        } catch (error) {
            this.fail(error);
        }
    }

    async play(): Promise<void> {
        if (this.destroyed || this.status === 'error' || !this.demuxer) {
            return;
        }
        if (this.status === 'ended') {
            return;
        }

        if (!(await this.resumeClock())) {
            // Autoplay was refused. Stay ready so the play control still works;
            // the next call comes from a real user gesture and will succeed.
            this.setStatus(this.pausedMediaTime > 0 ? 'paused' : 'ready');
            return;
        }

        this.setStatus('playing');
        this.startLoops();
        void this.pump();
    }

    /**
     * Start or resume the master clock.
     *
     * Returns false when the audio context refused to start, which is how a
     * blocked autoplay attempt surfaces. `resume()` is unreliable across engines
     * — it may stay pending forever, resolve with the context still suspended,
     * or reject — so the promise is raced against a timeout and the verdict
     * comes from `state` afterwards.
     */
    private async resumeClock(): Promise<boolean> {
        const context = this.audioContext;
        if (!context) {
            this.wallBaseMs = performance.now() - this.pausedMediaTime * 1000;
            return true;
        }

        if (context.state !== 'running') {
            let timer: number | undefined;
            try {
                await Promise.race([
                    context.resume(),
                    new Promise<void>((resolve) => {
                        timer = window.setTimeout(resolve, AUDIO_START_TIMEOUT_MS);
                    }),
                ]);
            } catch {
                // A rejected resume is just one more way of saying "blocked".
            } finally {
                window.clearTimeout(timer);
            }
        }

        if (context.state !== 'running') {
            return false;
        }
        if (this.audioBaseTime === null) {
            this.audioBaseTime = context.currentTime + AUDIO_START_LEAD;
        }
        return true;
    }

    private suspendClock(): void {
        if (this.audioContext) {
            void this.audioContext.suspend();
        }
    }

    pause(): void {
        if (this.status !== 'playing' && this.status !== 'buffering') {
            return;
        }
        this.pausedMediaTime = this.mediaTime;
        this.suspendClock();
        this.stopLoops();
        this.setStatus('paused');
    }

    async toggle(): Promise<void> {
        if (this.status === 'playing' || this.status === 'buffering') {
            this.pause();
        } else {
            await this.play();
        }
    }

    setVolume(volume: number): void {
        this.volume = Math.min(1, Math.max(0, volume));
        if (this.volume > 0) {
            this.muted = false;
        }
        this.applyGain();
        this.emit();
    }

    setMuted(muted: boolean): void {
        this.muted = muted;
        this.applyGain();
        this.emit();
    }

    toggleMuted(): void {
        this.setMuted(!this.muted);
    }

    private applyGain(): void {
        if (this.gain) {
            this.gain.gain.value = this.muted ? 0 : this.volume;
        }
    }

    async destroy(): Promise<void> {
        this.destroyed = true;
        this.stopLoops();
        await this.teardownPipeline();
    }

    /**
     * Release everything that produces output or holds resources: scheduled
     * audio, queued frames, the decoders, the audio graph and the in-flight
     * media request.
     *
     * Failure runs this too. There is no other player to hand off to, so an
     * error must not leave audio playing or a fetch running behind the error
     * state — the pipeline stops, and the status the caller set is preserved.
     */
    private async teardownPipeline(): Promise<void> {
        this.abortController.abort();

        for (const source of this.liveSources) {
            try {
                source.stop();
                source.disconnect();
            } catch {
                // Already finished or already disconnected.
            }
        }
        this.liveSources.clear();

        for (const frame of this.frameQueue) {
            frame.close();
        }
        this.frameQueue.length = 0;
        this.audioQueue.length = 0;

        this.closeDecoder(this.videoDecoder);
        this.closeDecoder(this.audioDecoder);
        this.videoDecoder = null;
        this.audioDecoder = null;

        this.gain?.disconnect();
        this.gain = null;
        await this.audioContext?.close().catch(() => undefined);
        this.audioContext = null;

        await this.demuxer?.close().catch(() => undefined);
        this.demuxer = null;
    }

    // ------------------------------------------------------------------- setup

    private async setUpVideo(
        demuxer: MediaDemuxer,
        labels: string[]
    ): Promise<void> {
        if (!demuxer.video) {
            return;
        }
        const config = await resolveVideoConfig(
            demuxer.video,
            demuxer.videoCodecFallbacks ?? []
        );
        if (!config) {
            throw new UnsupportedMediaError(
                `Video codec ${demuxer.video.codec} cannot be decoded here`
            );
        }

        this.videoConfig = config;
        this.videoDecoder = this.createVideoDecoder();
        labels.push(config.codec);
    }

    private async setUpAudio(
        demuxer: MediaDemuxer,
        labels: string[]
    ): Promise<void> {
        if (!demuxer.audio) {
            return;
        }
        if (!(await isAudioConfigSupported(demuxer.audio))) {
            throw new UnsupportedMediaError(
                `Audio codec ${demuxer.audio.codec} cannot be decoded here`
            );
        }

        this.audioContext = new AudioContext();
        // Keep the clock frozen until the first play() so scheduling stays aligned.
        void this.audioContext.suspend();
        this.gain = this.audioContext.createGain();
        this.gain.connect(this.audioContext.destination);
        this.applyGain();

        this.audioConfig = demuxer.audio;
        this.audioDecoder = this.createAudioDecoder();
        labels.push(demuxer.audio.codec);
    }

    private createVideoDecoder(): VideoDecoder {
        const decoder = new VideoDecoder({
            output: (frame) => this.onVideoFrame(frame),
            error: (error) => this.recoverDecoder(error, 'video'),
        });
        decoder.configure(this.videoConfig!);
        // Backpressure released: keep reading as soon as the decoder drains.
        decoder.ondequeue = () => void this.pump();
        return decoder;
    }

    private createAudioDecoder(): AudioDecoder {
        const decoder = new AudioDecoder({
            output: (data) => this.onAudioData(data),
            error: (error) => this.recoverDecoder(error, 'audio'),
        });
        decoder.configure(this.audioConfig!);
        decoder.ondequeue = () => void this.pump();
        return decoder;
    }

    /**
     * Rebuild a decoder that errored and carry on.
     *
     * A fatal codec error closes the decoder, so it cannot be `reset()` — it has
     * to be replaced. Video resumes at the next keyframe, since the new decoder
     * cannot start mid-GOP. With no other player to hand off to, surviving a
     * transient decode error is the only resilience this build has; a track that
     * keeps failing still ends in a clean terminal failure.
     */
    private recoverDecoder(error: unknown, kind: 'video' | 'audio'): void {
        if (this.destroyed || this.status === 'error') {
            return;
        }

        const attempts =
            kind === 'video' ? ++this.videoRecoveries : ++this.audioRecoveries;
        if (attempts > MAX_DECODER_RECOVERIES) {
            this.fail(error);
            return;
        }

        try {
            if (kind === 'video') {
                this.closeDecoder(this.videoDecoder);
                for (const frame of this.frameQueue) {
                    frame.close();
                }
                this.frameQueue.length = 0;
                this.awaitingKeyframe = true;
                this.videoDecoder = this.createVideoDecoder();
            } else {
                this.closeDecoder(this.audioDecoder);
                this.audioQueue.length = 0;
                this.audioDecoder = this.createAudioDecoder();
            }
        } catch {
            this.fail(error);
            return;
        }

        void this.pump();
    }

    // ------------------------------------------------------------------- clock

    private get mediaTime(): number {
        // Any state other than `playing` — including `buffering` — holds the
        // clock still, which is what stops a network stall from silently
        // running the playhead past data that has not arrived.
        if (this.status !== 'playing') {
            return this.pausedMediaTime;
        }
        if (this.audioContext && this.audioBaseTime !== null) {
            return Math.max(0, this.audioContext.currentTime - this.audioBaseTime);
        }
        return Math.max(0, (performance.now() - this.wallBaseMs) / 1000);
    }

    // -------------------------------------------------------------------- pump

    private async pump(): Promise<void> {
        if (this.pumping || this.destroyed || !this.demuxer) {
            return;
        }
        this.pumping = true;

        try {
            while (!this.destroyed && !this.demuxEnded) {
                if (this.frameQueue.length >= MAX_QUEUED_FRAMES) break;
                if (this.audioQueue.length >= MAX_QUEUED_AUDIO) break;
                if (
                    this.videoDecoder &&
                    this.videoDecoder.decodeQueueSize >= MAX_VIDEO_DECODE_QUEUE
                ) {
                    break;
                }
                // Without this, a file whose video track is absent leaves the
                // audio decoder as the only consumer and nothing bounds how much
                // encoded audio a fast local source can push into it.
                if (
                    this.audioDecoder &&
                    this.audioDecoder.decodeQueueSize >= MAX_AUDIO_DECODE_QUEUE
                ) {
                    break;
                }
                if (
                    this.status === 'playing' &&
                    this.lastPacketTime - this.mediaTime > LOOKAHEAD_SECONDS
                ) {
                    break;
                }

                const packet = await this.demuxer.next();
                if (!packet) {
                    this.demuxEnded = true;
                    break;
                }
                this.dispatch(packet);
            }

            if (this.demuxEnded && !this.flushed) {
                this.flushed = true;
                await this.videoDecoder?.flush().catch(() => undefined);
                await this.audioDecoder?.flush().catch(() => undefined);
            }
        } catch (error) {
            this.fail(error);
        } finally {
            this.pumping = false;
        }
    }

    private dispatch(packet: {
        kind: 'video' | 'audio';
        data: Uint8Array;
        timestamp: number;
        duration?: number;
        key: boolean;
    }): void {
        // Not clamped at zero: an edit list or codec delay puts priming samples
        // before the presentation origin, and the decoder needs them even though
        // they are never heard (see onAudioData).
        const timestamp = packet.timestamp - this.originUs;
        this.lastPacketTime = timestamp / 1e6;

        if (packet.kind === 'video') {
            if (!this.videoDecoder) return;
            // A decoder cannot start mid-GOP; wait for the first keyframe.
            if (this.awaitingKeyframe && !packet.key) return;
            this.awaitingKeyframe = false;
            this.videoDecoder.decode(
                new EncodedVideoChunk({
                    type: packet.key ? 'key' : 'delta',
                    timestamp,
                    ...(packet.duration ? { duration: packet.duration } : {}),
                    data: packet.data,
                })
            );
            return;
        }

        if (!this.audioDecoder) return;
        this.audioDecoder.decode(
            new EncodedAudioChunk({
                // Every AAC/Opus/FLAC packet is independently decodable, and the
                // decoder rejects a stream that opens on a delta chunk.
                type: 'key',
                timestamp,
                ...(packet.duration ? { duration: packet.duration } : {}),
                data: packet.data,
            })
        );
    }

    // ----------------------------------------------------------- decoder output

    private onVideoFrame(frame: VideoFrame): void {
        if (this.destroyed) {
            frame.close();
            return;
        }
        this.frameQueue.push(frame);
        if (this.status === 'ready' && this.frameQueue.length === 1) {
            // Show the opening frame instead of an empty canvas while paused.
            this.paint(this.frameQueue[0]);
        }
    }

    private onAudioData(data: AudioData): void {
        if (this.destroyed || !this.audioContext) {
            data.close();
            return;
        }
        // Samples that finish before the presentation origin are the codec's
        // priming: decoded for the decoder's benefit, never played.
        const endUs = data.timestamp + (data.duration ?? 0);
        if (endUs <= 0) {
            data.close();
            return;
        }
        try {
            const buffer = this.audioContext.createBuffer(
                data.numberOfChannels,
                data.numberOfFrames,
                data.sampleRate
            );
            const plane = new Float32Array(data.numberOfFrames);
            for (let channel = 0; channel < data.numberOfChannels; channel += 1) {
                data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
                buffer.copyToChannel(plane, channel);
            }
            this.audioQueue.push({ time: data.timestamp / 1e6, buffer });
        } catch (error) {
            this.fail(error);
        } finally {
            data.close();
        }
    }

    // ------------------------------------------------------------------ render

    private startLoops(): void {
        if (this.rafHandle === null) {
            this.rafHandle = requestAnimationFrame(() => this.tick());
        }
        if (this.snapshotTimer === null) {
            this.snapshotTimer = window.setInterval(
                () => this.emit(),
                SNAPSHOT_INTERVAL_MS
            );
        }
    }

    private stopLoops(): void {
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        if (this.snapshotTimer !== null) {
            window.clearInterval(this.snapshotTimer);
            this.snapshotTimer = null;
        }
    }

    private tick(): void {
        this.rafHandle = null;
        if (this.destroyed) {
            return;
        }

        if (this.status === 'buffering') {
            void this.pump();
            if (this.hasRebuffered()) {
                void this.leaveBuffering();
            }
        } else if (this.status === 'playing') {
            if (this.isStarved()) {
                this.enterBuffering();
            } else {
                const now = this.mediaTime;
                this.drawDueFrames(now);
                this.scheduleDueAudio(now);
                void this.pump();
                this.checkEnded(now);
            }
        } else {
            return;
        }

        if (this.status === 'playing' || this.status === 'buffering') {
            this.rafHandle = requestAnimationFrame(() => this.tick());
        }
    }

    /**
     * True when the demuxer has not produced data past the playhead.
     *
     * One signal covers both tracks: whatever the cause — a stalled fetch, a
     * decoder that cannot keep up — the symptom is the same, and continuing to
     * advance the clock would silently drop frames and punch gaps in the audio
     * instead of admitting the stall.
     */
    private isStarved(): boolean {
        if (this.demuxEnded) {
            return false;
        }
        return this.lastPacketTime - this.mediaTime < STARVE_MARGIN_SECONDS;
    }

    private hasRebuffered(): boolean {
        if (this.demuxEnded) {
            return true;
        }
        const videoReady =
            !this.videoDecoder || this.frameQueue.length >= REBUFFER_FRAMES;
        const audioReady =
            !this.audioDecoder || this.audioQueue.length >= REBUFFER_AUDIO_CHUNKS;
        return videoReady && audioReady;
    }

    /** Presentation time of the oldest decoded output still waiting to be used. */
    private oldestQueuedTime(): number | null {
        const times: number[] = [];
        if (this.frameQueue.length > 0) {
            times.push(this.frameQueue[0].timestamp / 1e6);
        }
        if (this.audioQueue.length > 0) {
            times.push(this.audioQueue[0].time);
        }
        return times.length > 0 ? Math.min(...times) : null;
    }

    /** Move the clock so that `mediaTime` reads `target` from now on. */
    private rebaseClock(target: number): void {
        this.pausedMediaTime = target;
        if (this.audioContext && this.audioBaseTime !== null) {
            this.audioBaseTime = this.audioContext.currentTime - target;
        } else {
            this.wallBaseMs = performance.now() - target * 1000;
        }
    }

    private enterBuffering(): void {
        this.pausedMediaTime = this.mediaTime;
        this.suspendClock();
        this.setStatus('buffering');
    }

    private async leaveBuffering(): Promise<void> {
        if (this.status !== 'buffering') {
            return;
        }

        // Resume from the oldest decoded output when the playhead has run past
        // it. That happens whenever the clock keeps moving while the render loop
        // does not — a hidden tab stops requestAnimationFrame but the audio
        // context keeps time — and without this the playhead would wait for a
        // stream position it has already overshot and never restart.
        const oldest = this.oldestQueuedTime();
        const resumeAt =
            oldest === null ? this.pausedMediaTime : Math.min(this.pausedMediaTime, oldest);

        if (!(await this.resumeClock())) {
            this.setStatus('paused');
            return;
        }
        if (this.status !== 'buffering') {
            return;
        }
        this.rebaseClock(resumeAt);
        this.setStatus('playing');
    }

    private drawDueFrames(now: number): void {
        let due: VideoFrame | null = null;
        while (
            this.frameQueue.length > 0 &&
            this.frameQueue[0].timestamp / 1e6 <= now
        ) {
            const frame = this.frameQueue.shift()!;
            // Drop frames we are already past rather than stalling the clock.
            due?.close();
            due = frame;
        }
        if (due) {
            this.paint(due);
            this.lastDrawnTime = due.timestamp / 1e6;
            due.close();
        }
    }

    private paint(frame: VideoFrame): void {
        if (!this.context) {
            return;
        }
        const width = frame.displayWidth || frame.codedWidth;
        const height = frame.displayHeight || frame.codedHeight;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        if (height > 0) {
            const ratio = width / height;
            if (this.aspectRatio !== ratio) {
                // Drives the container's shape, so portrait and 4:3 sources stop
                // being letterboxed into a hardcoded 16:9 box.
                this.aspectRatio = ratio;
                this.emit();
            }
        }
        this.context.drawImage(frame, 0, 0, width, height);
    }

    private scheduleDueAudio(now: number): void {
        const context = this.audioContext;
        if (!context || !this.gain || this.audioBaseTime === null) {
            return;
        }

        while (
            this.audioQueue.length > 0 &&
            this.audioQueue[0].time <= now + AUDIO_SCHEDULE_AHEAD
        ) {
            const chunk = this.audioQueue.shift()!;
            const when = this.audioBaseTime + chunk.time;
            if (when < context.currentTime - AUDIO_LATE_TOLERANCE) {
                continue;
            }

            const source = context.createBufferSource();
            source.buffer = chunk.buffer;
            source.connect(this.gain);
            source.onended = () => this.liveSources.delete(source);
            this.liveSources.add(source);
            source.start(Math.max(when, context.currentTime));
        }
    }

    private checkEnded(now: number): void {
        if (
            !this.demuxEnded ||
            this.frameQueue.length > 0 ||
            this.audioQueue.length > 0
        ) {
            return;
        }
        const end =
            this.durationSeconds ??
            Math.max(this.lastDrawnTime, this.lastPacketTime);
        if (now >= end - 0.1) {
            this.pausedMediaTime = end;
            this.stopLoops();
            this.setStatus('ended');
            this.options.onEnded?.();
        }
    }

    // ------------------------------------------------------------------- state

    private closeDecoder(decoder: VideoDecoder | AudioDecoder | null): void {
        if (decoder && decoder.state !== 'closed') {
            decoder.close();
        }
    }

    private fail(error: unknown): void {
        if (this.destroyed || this.status === 'error') {
            return;
        }
        this.unsupported = error instanceof UnsupportedMediaError;
        this.errorMessage =
            error instanceof Error ? error.message : 'Compatibility playback failed';
        // Latch the status before tearing down: aborting the fetch makes the
        // in-flight pump throw straight back into fail(), and the guard above
        // is what stops that recursing.
        this.status = 'error';
        this.stopLoops();
        // Stop producing before reporting: an error overlay with audio still
        // coming out of the speakers is the worst end state on a car display.
        void this.teardownPipeline();
        this.emit();
    }

    private setStatus(status: PlaybackStatus): void {
        this.status = status;
        this.emit();
    }

    private emit(): void {
        this.options.onChange({
            status: this.status,
            currentTime: this.mediaTime,
            duration: this.durationSeconds,
            error: this.errorMessage,
            pipeline: this.pipeline,
            unsupported: this.unsupported,
            aspectRatio: this.aspectRatio,
            volume: this.volume,
            muted: this.muted,
            buffering: this.status === 'buffering',
        });
    }
}
