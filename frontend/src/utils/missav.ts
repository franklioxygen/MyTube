// Keep this hostname mirror aligned with backend/src/utils/helpers.ts and
// backend/src/services/downloaders/missav/constants.ts.
export const MISSAV_HOSTNAMES = [
  'missav.com',
  'missav.ai',
  'missav.ws',
  'missav.live',
  '123av.com',
  '123av.ai',
  '123av.ws',
  'javxx.com',
  'njavtv.com',
] as const;

export function isMissAVUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return MISSAV_HOSTNAMES.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}
