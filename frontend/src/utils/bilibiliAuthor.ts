/** Compare profile identities rather than mutable display names. */
export function getBilibiliAuthorId(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'space.bilibili.com' || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/(\d+)(?:\/(?:video|upload\/video))?\/?$/);
    const id = match?.[1].replace(/^0+/, '');
    return id && /^[1-9]\d{0,19}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
