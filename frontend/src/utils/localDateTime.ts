export interface LocalDateTimeOption {
  timestamp: number;
  offsetMinutes: number;
  label: string;
}

/** Return every instant represented by a local wall time, including DST overlaps. */
export function getLocalDateTimeOptions(value: string): LocalDateTimeOption[] {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return [];
  const normalized = `${match[1]}:${match[2] ?? '00'}.${(match[3] ?? '').padEnd(3, '0')}`;
  const wallTime = new Date(`${normalized}Z`);
  if (!Number.isFinite(wallTime.getTime()) || wallTime.toISOString() !== `${normalized}Z`) return [];

  // The offsets on either side of a transition can both represent the same
  // wall time. Round-trip each candidate to also reject spring-forward gaps.
  const offsets = new Set<number>();
  for (const days of [-2, -1, 0, 1, 2]) {
    offsets.add(new Date(wallTime.getTime() + days * 86_400_000).getTimezoneOffset());
  }
  return [...offsets].flatMap((offsetMinutes) => {
    const timestamp = wallTime.getTime() + offsetMinutes * 60_000;
    const date = new Date(timestamp);
    if (date.getTimezoneOffset() !== offsetMinutes) return [];
    const sign = offsetMinutes <= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
    const minutes = String(absoluteOffset % 60).padStart(2, '0');
    return [{ timestamp, offsetMinutes, label: `UTC${sign}${hours}:${minutes}` }];
  }).sort((a, b) => a.timestamp - b.timestamp);
}
