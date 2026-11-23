/**
 * Apply one Tags Management edit (`before` -> `after`) onto the latest
 * confirmed catalog, so an edit queued behind a rename does not restore the
 * old name or drop the new one (issue #546).
 *
 * `renames` were requested before the edit. When the page still showed the
 * old name (and not yet the new one) and the edit deleted it, the deletion
 * carries over to the new name.
 */
export function rebaseTagEdit(
    confirmed: string[],
    before: string[],
    after: string[],
    renames: ReadonlyArray<readonly [string, string]> = []
): string[] {
    const removed = new Set(before.filter(tag => !after.includes(tag)));
    for (const [oldTag, newTag] of renames) {
        if (removed.has(oldTag) && !before.includes(newTag)) removed.add(newTag);
    }
    const result = confirmed.filter(tag => !removed.has(tag));
    for (const tag of after) {
        if (before.includes(tag)) continue;
        if (!result.some(existing => existing.toLowerCase() === tag.toLowerCase())) {
            result.push(tag);
        }
    }
    return result;
}
