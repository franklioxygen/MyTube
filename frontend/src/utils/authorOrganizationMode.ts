import type { AuthorOrganizationMode } from '../types';

export function resolveAuthorOrganizationMode(settings: {
    authorOrganizationMode?: unknown;
    saveAuthorFilesToCollection?: unknown;
}): AuthorOrganizationMode {
    if (
        settings.authorOrganizationMode === 'root' ||
        settings.authorOrganizationMode === 'author_folder_only' ||
        settings.authorOrganizationMode === 'author_collection_linked'
    ) {
        return settings.authorOrganizationMode;
    }

    return settings.saveAuthorFilesToCollection === true
        ? 'author_collection_linked'
        : 'root';
}
