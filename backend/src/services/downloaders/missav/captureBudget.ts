/**
 * Bounds how many playlist bodies the MissAV page capture reads and keeps, and
 * how large they may be in total.
 *
 * Responses arrive concurrently, so every check has to hold for bodies that are
 * still being read, not only for those already kept. Room is therefore reserved
 * before a read starts and reconciled once the decoded size is known. The
 * reservation is provisional in both directions: an undeclared length reserves
 * the per-body cap, and a declared one may be the compressed size on the wire,
 * so the decoded body is checked against the limits again before it is kept.
 */
export interface CaptureTicket {
  /**
   * Settle the reservation. With a size, keep the body if it still fits and
   * return true; otherwise release the room and return false. With null, just
   * release. Only the first call has any effect.
   */
  settle(decodedBytes: number | null): boolean;
}

export class PlaylistCaptureBudget {
  private count = 0;
  private bytes = 0;

  constructor(
    private readonly maxBodies: number,
    private readonly maxBytesPerBody: number,
    private readonly maxTotalBytes: number,
  ) {}

  /**
   * Reserve room for a body before reading it, or null if there is none. A body
   * that already declares itself larger than the per-body cap is refused here,
   * so it is never materialised only to be thrown away.
   */
  reserve(declaredLength: number): CaptureTicket | null {
    const declared =
      Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : null;
    if (declared !== null && declared > this.maxBytesPerBody) return null;

    const reserved = declared ?? this.maxBytesPerBody;
    if (this.count >= this.maxBodies || this.bytes + reserved > this.maxTotalBytes) {
      return null;
    }
    this.count += 1;
    this.bytes += reserved;

    let settled = false;
    return {
      settle: (decodedBytes) => {
        if (settled) return false;
        settled = true;
        this.bytes -= reserved;
        if (
          decodedBytes === null ||
          decodedBytes > this.maxBytesPerBody ||
          this.bytes + decodedBytes > this.maxTotalBytes
        ) {
          this.count -= 1;
          return false;
        }
        this.bytes += decodedBytes;
        return true;
      },
    };
  }

  /** Exposed for tests. */
  get usage(): { count: number; bytes: number } {
    return { count: this.count, bytes: this.bytes };
  }
}
