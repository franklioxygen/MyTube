/** Merge without mutating the catalog; retain its canonical spelling. */
export function mergeTagCatalog(catalog: readonly string[], requested: readonly string[]) {
  const canonical = new Map<string, string>();
  for (const tag of catalog) {
    if (!canonical.has(tag.toLowerCase())) canonical.set(tag.toLowerCase(), tag);
  }
  const added: string[] = [];
  for (const value of requested) {
    const tag = typeof value === "string" ? value.trim() : "";
    if (tag && !canonical.has(tag.toLowerCase())) {
      canonical.set(tag.toLowerCase(), tag);
      added.push(tag);
    }
  }
  return {
    canonical, added,
    tags: added.length ? [...catalog, ...added].sort((a, b) => a.localeCompare(b)) : [...catalog],
  };
}
