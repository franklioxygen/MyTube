export const MAX_BULK_VIDEOS = 500;
export const MAX_BULK_TAGS = 20;

export function hasControlCharacters(value: string): boolean {
    return Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || (code >= 127 && code <= 159);
    });
}

export interface BulkResult {
    requestedCount: number;
    changedVideoIds: string[];
    unchangedVideoIds: string[];
    catalogChanged?: boolean;
    videos?: Array<{ id: string; tags: string[] }>;
    collection?: { id: string; name: string; created: boolean };
}

export type BulkOperation =
    | { kind: 'tags'; videoIds: string[]; tags: string[] }
    | { kind: 'collection'; videoIds: string[]; collectionId: string }
    | { kind: 'collection'; videoIds: string[]; newCollection: { id: string; name: string } };

export function createCollectionId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // Web Crypto random bytes also work on HTTP NAS deployments.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeBulkTags(tags: string[]): string[] {
    const unique = new Map<string, string>();
    for (const value of tags) {
        const tag = value.trim();
        if (tag && !unique.has(tag.toLowerCase())) unique.set(tag.toLowerCase(), tag);
    }
    return [...unique.values()];
}

export function validBulkTags(tags: string[]): boolean {
    return tags.length > 0 && tags.length <= MAX_BULK_TAGS && tags.every(
        (tag) => Array.from(tag).length <= 80 && !hasControlCharacters(tag),
    );
}

export function bulkErrorDetails(error: unknown): {
    status?: number; message?: string; missingVideoIds: string[]; existingCollectionId?: string;
} {
    const response = (error as { response?: { status?: number; data?: {
        error?: string; details?: { missingVideoIds?: unknown; existingCollectionId?: unknown };
    } } } | null)?.response;
    const missing = response?.data?.details?.missingVideoIds;
    const existing = response?.data?.details?.existingCollectionId;
    return {
        status: response?.status,
        message: response?.data?.error,
        missingVideoIds: Array.isArray(missing) ? missing.filter((id): id is string => typeof id === 'string') : [],
        existingCollectionId: typeof existing === 'string' ? existing : undefined,
    };
}
