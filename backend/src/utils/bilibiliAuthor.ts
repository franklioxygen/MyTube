/** Stable author identity; never follow an arbitrary URL supplied as a query. */
export function getBilibiliAuthorId(value: string): string | null {
  let id = value.trim();
  if (!/^\d+$/.test(id)) {
    try {
      const url = new URL(id);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.hostname !== "space.bilibili.com" || url.port || url.username || url.password
      ) return null;
      const match = url.pathname.match(/^\/(\d+)(?:\/(?:video|upload\/video))?\/?$/);
      if (!match) return null;
      id = match[1];
    } catch {
      return null;
    }
  }
  id = id.replace(/^0+/, "");
  return /^[1-9]\d{0,19}$/.test(id) ? id : null;
}
