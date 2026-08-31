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
    /** True when playback stalled waiting for data rather than for the user. */
    buffering: boolean;
    /** Whether this file can be repositioned. */
    canSeek: boolean;
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
/**
 * Fallback pacing for the render loop when animation frames stop arriving.
 * A hidden, occluded or throttled page gets no `requestAnimationFrame`
 * callbacks, and the loop must not depend on one to schedule the next.
 */
const TICK_FALLBACK_MS = 100;
const MAX_AUDIO_DECODE_QUEUE = 48;

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

    private originUs = 0;
    private lastPacketTime = 0;
    private audioBaseTime: number | null = null;
    private wallBaseMs = 0;
    private pausedMediaTime = 0;
    private lastDrawnTime = 0;
    /** Media time up to which audio has already been handed to Web Audio. */
    private scheduledAudioUntil = 0;

    private rafHandle: number | null = null;
    private tickFallbackTimer: number | null = null;
    private loopRunning = false;
    private snapshotTimer: number | null = null;
    private pumpTask: Promise<void> | null = null;
    /**
     * Set while a seek is repositioning the demuxer. The decoders' `dequeue`
     * events fire independently of the render loop, so without this a pump
     * could call `next()` while `seek()` is still moving the byte stream and
     * leave the container parser reading from the wrong offset.
     */
    private seeking = false;
    /**
     * Bumped by every seek. The pump checks it after each await so a packet
     * read for the old position cannot be decoded into the new one.
     */
    private seekGeneration = 0;
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
            // Offset by the current position so a resume-from-saved-progress
            // seek before the first play does not snap the clock back to zero.
            this.audioBaseTime =
                context.currentTime + AUDIO_START_LEAD - this.pausedMediaTime;
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

    /**
     * Reposition playback.
     *
     * Everything downstream of the demuxer has to be discarded: frames and
     * audio already decoded belong to the old position, scheduled audio is
     * already committed to the Web Audio timeline, and a decoder cannot be
     * handed a mid-GOP frame after a jump. The clock is then rebased so the
     * playhead reads the new position rather than resuming its old count.
     */
    async seek(seconds: number): Promise<void> {
        const demuxer = this.demuxer;
        if (
            !demuxer?.canSeek ||
            this.destroyed ||
            this.status === 'error' ||
            this.seeking
        ) {
            return;
        }

        const limit = this.durationSeconds ?? Number.POSITIVE_INFINITY;
        const target = Math.min(Math.max(0, seconds), Math.max(0, limit - 0.25));
        const wasPlaying =
            this.status === 'playing' || this.status === 'buffering';

        this.stopLoops();
        this.suspendClock();

        let landedUs: number;
        this.seeking = true;
        try {
            // Retire any read already in flight before touching the demuxer, so
            // it cannot reposition the byte stream under a pending request.
            this.seekGeneration += 1;
            await this.pumpTask?.catch(() => undefined);

            this.stopScheduledAudio();
            for (const frame of this.frameQueue) {
                frame.close();
            }
            this.frameQueue.length = 0;
            this.audioQueue.length = 0;
            this.scheduledAudioUntil = 0;
            this.lastPacketTime = 0;
            this.demuxEnded = false;
            this.flushed = false;
            this.awaitingKeyframe = true;
            this.resetDecoders();

            landedUs = await demuxer.seek(this.originUs + target * 1e6);
        } catch (error) {
            this.fail(error);
            return;
        } finally {
            this.seeking = false;
        }

        if (this.destroyed) {
            return;
        }

        this.rebaseClock(Math.max(0, (landedUs - this.originUs) / 1e6));
        this.lastPacketTime = this.pausedMediaTime;
        await this.pump();

        if (wasPlaying) {
            await this.play();
        } else {
            this.setStatus(this.pausedMediaTime > 0 ? 'paused' : 'ready');
        }
    }

    /**
     * Seek relative to where playback actually is, read from the live clock
     * rather than from a snapshot the caller may be holding.
     */
    async seekBy(deltaSeconds: number): Promise<void> {
        await this.seek(this.mediaTime + deltaSeconds);
    }

    /** Drop decoder state so playback can restart at a keyframe. */
    private resetDecoders(): void {
        if (this.videoDecoder && this.videoDecoder.state !== 'closed') {
            this.videoDecoder.reset();
            this.videoDecoder.configure(this.videoConfig!);
        }
        if (this.audioDecoder && this.audioDecoder.state !== 'closed') {
            this.audioDecoder.reset();
            this.audioDecoder.configure(this.audioConfig!);
        }
    }

    async toggle(): Promise<void> {
        if (this.status === 'playing' || this.status === 'buffering') {
            this.pause();
        } else {
            await this.play();
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
    private stopScheduledAudio(): void {
        for (const source of this.liveSources) {
            try {
                source.stop();
                source.disconnect();
            } catch {
                // Already finished or already disconnected.
            }
        }
        this.liveSources.clear();
    }

    private async teardownPipeline(): Promise<void> {
        this.abortController.abort();
        this.stopScheduledAudio();

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
        // Output is fixed at unity: the car provides its own volume control, so
        // the player does not offer a second one to get out of sync with.
        this.gain = this.audioContext.createGain();
        this.gain.gain.value = 1;
        this.gain.connect(this.audioContext.destination);

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

    private pump(): Promise<void> {
        if (this.pumpTask) {
            return this.pumpTask;
        }
        if (this.destroyed || !this.demuxer || this.seeking) {
            return Promise.resolve();
        }
        this.pumpTask = this.runPump().finally(() => {
            this.pumpTask = null;
        });
        return this.pumpTask;
    }

    private async runPump(): Promise<void> {
        const generation = this.seekGeneration;
        try {
            while (!this.destroyed && !this.demuxEnded && this.demuxer) {
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

                const packet = await this.demuxer!.next();
                if (generation !== this.seekGeneration) {
                    // A seek landed while this read was in flight; the packet
                    // belongs to the old position and must not be decoded.
                    return;
                }
                if (!packet) {
                    this.demuxEnded = true;
                    break;
                }
                this.dispatch(packet);
            }

            if (this.demuxEnded && !this.flushed) {
                this.flushed = true;
                // A rejected terminal flush means the decoder could not accept
                // the tail of the stream. Let the outer catch fail playback;
                // swallowing it would drain the queues, report `ended`, and
                // autoplay onward after silently dropping corrupt media.
                await this.videoDecoder?.flush();
                await this.audioDecoder?.flush();
            }
        } catch (error) {
            this.fail(error);
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
        if (
            (this.status === 'ready' || this.status === 'paused') &&
            this.frameQueue.length === 1
        ) {
            // Show the opening or newly sought frame while playback is paused.
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
        this.loopRunning = true;
        this.scheduleTick();
        if (this.snapshotTimer === null) {
            this.snapshotTimer = window.setInterval(
                () => this.emit(),
                SNAPSHOT_INTERVAL_MS
            );
        }
    }

    /**
     * Ask for the next tick from an animation frame *and* a timer, whichever
     * arrives first.
     *
     * The loop used to be a bare `requestAnimationFrame` chain in which `tick()`
     * scheduled its own successor. That has a single point of failure: a page
     * that is hidden, occluded or throttled never delivers the pending callback,
     * so the chain stops for good — audio keeps playing from the Web Audio clock
     * while the canvas freezes on whatever frame was last drawn. The timer is
     * the floor that keeps the loop alive; it also keeps a hidden page decoding
     * at a reduced rate instead of stalling.
     */
    private scheduleTick(): void {
        if (!this.loopRunning || this.destroyed) {
            return;
        }
        this.cancelPendingTick();
        this.rafHandle = requestAnimationFrame(this.runTick);
        this.tickFallbackTimer = window.setTimeout(this.runTick, TICK_FALLBACK_MS);
    }

    private cancelPendingTick(): void {
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        if (this.tickFallbackTimer !== null) {
            window.clearTimeout(this.tickFallbackTimer);
            this.tickFallbackTimer = null;
        }
    }

    /** Whichever of the two schedulers fires first wins; the other is dropped. */
    private readonly runTick = (): void => {
        this.cancelPendingTick();
        this.tick();
    };

    private stopLoops(): void {
        this.loopRunning = false;
        this.cancelPendingTick();
        if (this.snapshotTimer !== null) {
            window.clearInterval(this.snapshotTimer);
            this.snapshotTimer = null;
        }
    }

    private tick(): void {
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
            this.scheduleTick();
        }
    }

    /**
     * True when there is nothing left to present on a track that should have
     * something.
     *
     * Measured against decoded output, not against how far the demuxer has read.
     * Demux position is not a usable signal here: `pump()` deliberately stops
     * once any queue reaches its cap, which looks identical to a stall while
     * there is in fact a second of video sitting decoded and ready.
     */
    private isStarved(): boolean {
        if (this.demuxEnded) {
            return false;
        }
        const videoStarved =
            this.videoDecoder !== null && this.frameQueue.length === 0;
        const audioStarved =
            this.audioDecoder !== null &&
            this.audioQueue.length === 0 &&
            this.scheduledAudioUntil <= this.mediaTime;
        return videoStarved || audioStarved;
    }

    private hasRebuffered(): boolean {
        if (this.demuxEnded) {
            return true;
        }
        const videoReady =
            !this.videoDecoder || this.frameQueue.length >= REBUFFER_FRAMES;
        const audioReady =
            !this.audioDecoder ||
            this.audioQueue.length >= REBUFFER_AUDIO_CHUNKS ||
            // The pump stops as soon as *any* queue hits its cap, so waiting for
            // more audio while the frame queue is full deadlocks: no further
            // packets can be read until frames are drawn, and frames are only
            // drawn once playback resumes. A full frame queue therefore counts
            // as "as ready as this stream is going to get".
            this.frameQueue.length >= MAX_QUEUED_FRAMES;
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
            this.scheduledAudioUntil = Math.max(
                this.scheduledAudioUntil,
                chunk.time + chunk.buffer.length / chunk.buffer.sampleRate
            );
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
            buffering: this.status === 'buffering',
            canSeek: this.demuxer?.canSeek ?? false,
        });
    }
}
