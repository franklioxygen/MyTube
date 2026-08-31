/**
 * Sequential byte reader over an HTTP media URL, with seek support.
 *
 * Compatibility mode has to do the job the browser normally does inside
 * `<video>`: pull the container bytes itself. This reader keeps a small sliding
 * window of a streamed `fetch` response so a demuxer can walk the file
 * forwards cheaply, and re-issues a ranged request when it needs to jump
 * (an MP4 `moov` box sitting after `mdat` is the motivating case).
 */

const INITIAL_CAPACITY = 1 << 16; // 64 KiB
const TRIM_THRESHOLD = 1 << 20; // reclaim consumed bytes past 1 MiB
/** Jumping further ahead than this reopens the connection instead of draining. */
const MAX_FORWARD_DRAIN = 512 * 1024;

export interface ByteStreamOptions {
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
}

const nextCapacity = (needed: number): number => {
  let capacity = INITIAL_CAPACITY;
  while (capacity < needed) {
    capacity *= 2;
  }
  return capacity;
};

export class ByteStream {
  /** Total file size once the server has told us, otherwise null. */
  totalSize: number | null = null;

  private readonly url: string;
  private readonly signal?: AbortSignal;
  private readonly credentials: RequestCredentials;
  private readonly fetchImpl: typeof fetch;

  private data = new Uint8Array(INITIAL_CAPACITY);
  private dataStart = 0;
  private dataEnd = 0;
  /** Absolute file offset of `data[dataStart]`. */
  private windowStart = 0;
  /** Absolute file offset of the read position. */
  private cursor = 0;

  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private pendingSkip = 0;
  private eof = false;

  constructor(url: string, options: ByteStreamOptions = {}) {
    this.url = url;
    this.signal = options.signal;
    this.credentials = options.credentials ?? "same-origin";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get position(): number {
    return this.cursor;
  }

  /** Bytes already buffered ahead of the cursor. */
  get available(): number {
    return this.windowEnd - this.cursor;
  }

  /**
   * Open an independent cursor over the same resource and request options.
   * MP4 uses one cursor per selected track so a physically non-interleaved file
   * can feed audio and video without repeatedly reopening the same connection.
   */
  fork(): ByteStream {
    return new ByteStream(this.url, {
      signal: this.signal,
      credentials: this.credentials,
      fetchImpl: this.fetchImpl,
    });
  }

  private get windowEnd(): number {
    return this.windowStart + (this.dataEnd - this.dataStart);
  }

  private get cursorIndex(): number {
    return this.dataStart + (this.cursor - this.windowStart);
  }

  /**
   * Buffer at least `count` bytes ahead of the cursor.
   * Returns false when the stream ended first.
   */
  async ensure(count: number): Promise<boolean> {
    while (this.available < count) {
      if (!(await this.pull())) {
        return false;
      }
    }
    return true;
  }

  /**
   * A view of the next `count` buffered bytes without advancing.
   * The view aliases the internal buffer — copy it before the next read.
   */
  peek(count: number): Uint8Array {
    const start = this.cursorIndex;
    return this.data.subarray(start, start + count);
  }

  /** Read `count` buffered bytes as a copy and advance the cursor. */
  read(count: number): Uint8Array {
    const bytes = this.peek(count).slice();
    this.cursor += bytes.length;
    this.trim();
    return bytes;
  }

  /** Ensure + read, throwing when the stream ends early. */
  async require(count: number): Promise<Uint8Array> {
    if (!(await this.ensure(count))) {
      throw new Error(
        `Unexpected end of media at byte ${this.cursor} (needed ${count})`
      );
    }
    return this.read(count);
  }

  /** Move the read position, reusing the open connection where sensible. */
  async seek(offset: number): Promise<void> {
    if (offset >= this.windowStart && offset <= this.windowEnd) {
      this.cursor = offset;
      this.trim();
      return;
    }

    if (
      this.reader &&
      offset > this.windowEnd &&
      offset - this.windowEnd <= MAX_FORWARD_DRAIN
    ) {
      this.cursor = this.windowEnd;
      if (await this.ensure(offset - this.cursor)) {
        this.cursor = offset;
        this.trim();
        return;
      }
    }

    await this.closeReader();
    this.dataStart = 0;
    this.dataEnd = 0;
    this.windowStart = offset;
    this.cursor = offset;
    this.eof = false;
  }

  async close(): Promise<void> {
    await this.closeReader();
  }

  private async pull(): Promise<boolean> {
    if (this.eof) {
      return false;
    }
    if (!this.reader) {
      await this.openReaderAt(this.windowEnd);
    }
    const { done, value } = await this.reader!.read();
    if (done || !value) {
      this.eof = true;
      return false;
    }

    let bytes = value;
    if (this.pendingSkip > 0) {
      const skipped = Math.min(this.pendingSkip, bytes.length);
      bytes = bytes.subarray(skipped);
      this.pendingSkip -= skipped;
    }
    if (bytes.length > 0) {
      this.append(bytes);
    }
    return true;
  }

  private async openReaderAt(offset: number): Promise<void> {
    const headers: Record<string, string> = {};
    if (offset > 0) {
      headers.Range = `bytes=${offset}-`;
    }

    const response = await this.fetchImpl(this.url, {
      headers,
      credentials: this.credentials,
      signal: this.signal,
    });

    if (!response.ok) {
      throw new Error(`Media request failed with status ${response.status}`);
    }
    if (!response.body) {
      throw new Error("Media response has no readable body");
    }

    this.readTotalSize(response, offset);

    // A server that ignores Range restarts at byte 0; drop the prefix by hand.
    this.pendingSkip = offset > 0 && response.status !== 206 ? offset : 0;
    this.reader = response.body.getReader();
  }

  private readTotalSize(response: Response, offset: number): void {
    const contentRange = response.headers.get("Content-Range");
    if (contentRange) {
      const total = Number.parseInt(contentRange.split("/")[1] ?? "", 10);
      if (Number.isFinite(total)) {
        this.totalSize = total;
        return;
      }
    }
    if (offset === 0) {
      const length = Number.parseInt(
        response.headers.get("Content-Length") ?? "",
        10
      );
      if (Number.isFinite(length)) {
        this.totalSize = length;
      }
    }
  }

  private append(bytes: Uint8Array): void {
    const used = this.dataEnd - this.dataStart;
    if (this.data.length - this.dataEnd < bytes.length) {
      if (this.data.length - used >= bytes.length) {
        this.data.copyWithin(0, this.dataStart, this.dataEnd);
      } else {
        const grown = new Uint8Array(nextCapacity(used + bytes.length));
        grown.set(this.data.subarray(this.dataStart, this.dataEnd));
        this.data = grown;
      }
      this.dataStart = 0;
      this.dataEnd = used;
    }
    this.data.set(bytes, this.dataEnd);
    this.dataEnd += bytes.length;
  }

  private trim(): void {
    const consumed = this.cursor - this.windowStart;
    if (consumed >= TRIM_THRESHOLD) {
      this.dataStart += consumed;
      this.windowStart = this.cursor;
    }
  }

  private async closeReader(): Promise<void> {
    const reader = this.reader;
    this.reader = null;
    this.pendingSkip = 0;
    if (!reader) {
      return;
    }
    try {
      await reader.cancel();
    } catch {
      // A cancelled/aborted body is expected when we jump or tear down.
    }
  }
}
