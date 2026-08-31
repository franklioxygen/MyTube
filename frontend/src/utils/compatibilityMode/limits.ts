/**
 * Hard limits applied to values read out of media containers.
 *
 * Everything the demuxers read is attacker-controlled in the sense that matters
 * here: a truncated download or a corrupt file can claim any 32-bit count or
 * size. On the car display a hung or out-of-memory tab has no second player to
 * fall back to, so every count is bounded before it is used to allocate, and
 * every payload size is bounded before it is buffered.
 */

/** Largest single encoded video/audio sample we will read into memory. */
export const MAX_ENCODED_PAYLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Upper bound on samples in one track. 8M samples is over 37 hours at 60 fps,
 * well past anything the downloader produces.
 */
export const MAX_SAMPLE_TABLE_ENTRIES = 8_000_000;

/** Largest `moov` box we will buffer. */
export const MAX_MOOV_BYTES = 64 * 1024 * 1024;

/** Largest EBML header element (`Info`, `Tracks`, `BlockGroup`) we will buffer. */
export const MAX_HEADER_ELEMENT_BYTES = 8 * 1024 * 1024;

/**
 * Number of fixed-size records that fit in a box, used to bound a declared
 * entry count against the bytes actually present.
 */
export const recordsThatFit = (
  contentStart: number,
  contentEnd: number,
  headerBytes: number,
  recordBytes: number
): number => Math.max(0, Math.floor((contentEnd - contentStart - headerBytes) / recordBytes));
