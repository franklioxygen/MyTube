/** Shared types for the compatibility-mode demuxers. */

export type TrackKind = "video" | "audio";

export interface DemuxedPacket {
  kind: TrackKind;
  /** Owned copy of the encoded sample. */
  data: Uint8Array;
  /** Presentation timestamp in microseconds. */
  timestamp: number;
  /** Sample duration in microseconds, when the container states one. */
  duration?: number;
  key: boolean;
}

export interface MediaDemuxer {
  container: "mp4" | "webm";
  video: VideoDecoderConfig | null;
  audio: AudioDecoderConfig | null;
  /**
   * Alternate codec strings to try when `video.codec` is rejected. WebM carries
   * no VP9 decoder-configuration record, so its profile and bit depth come from
   * the frame header while plausible level strings are support-probed here.
   */
  videoCodecFallbacks?: string[];
  /** Media duration in microseconds, when the container states one. */
  durationUs: number | null;
  /**
   * Presentation timestamp of the first frame meant to be shown, in
   * microseconds. The engine uses this as its time origin instead of guessing
   * from the first packet it happens to see, which is wrong whenever B-frames
   * put a later composition time first.
   */
  startTimeUs: number;
  /**
   * Video/audio tracks the container carries that could not be mapped to a
   * decoder configuration, described by their codec identifier.
   *
   * Reported rather than silently dropped: on a display with no other player,
   * "plays with no sound" or "plays as a black canvas" is a worse outcome than
   * a clear failure, and a null `video`/`audio` alone cannot distinguish an
   * unsupported track from an absent one.
   */
  unsupportedTracks: string[];
  /**
   * Whether `seek` can reposition this file. MP4 always can, from its sync
   * sample table; WebM needs a `Cues` index, which most muxers write but none
   * are obliged to.
   */
  canSeek: boolean;
  /**
   * Reposition to the last random-access point at or before `timeUs`, and
   * return the presentation time actually landed on. Decoding cannot start
   * mid-GOP, so the caller gets the keyframe's time, not the time it asked for.
   */
  seek(timeUs: number): Promise<number>;
  /** Next packet in decode order; null once the stream is exhausted. */
  next(): Promise<DemuxedPacket | null>;
  close(): Promise<void>;
}

/**
 * Thrown when the container or its codecs are outside what compatibility mode
 * can demux. Surfaced to the user as a "fall back to the normal player" hint
 * rather than as a crash.
 */
export class UnsupportedMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMediaError";
  }
}
