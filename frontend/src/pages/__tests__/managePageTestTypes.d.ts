// Type definitions for ManagePage.test.tsx mock captured props
// Extracted to reduce global scope complexity (lizard nloc/ccn)

export interface CapturedVideosTableProps {
    totalVideosCount: number;
    searchTerm: string;
    page: number;
    totalSize: number;
    onSearchChange?: (value: string) => void;
    onDeleteClick?: (id: string) => void;
    onRefreshThumbnail?: (id: string) => void;
    onRefreshFileSizes?: () => void;
    onPageChange?: (event: unknown, page: number) => void;
    onSort?: (field: string) => void;
    onUpdateVideo: (id: string, data: Record<string, unknown>) => void;
}

export interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText: string;
    cancelText: string;
    onClose: () => void;
}

export interface DeleteCollectionModalProps {
    isOpen: boolean;
    collectionName: string;
    videoCount: number;
    onDeleteCollectionOnly: () => void;
    onDeleteCollectionAndVideos: () => void;
    onClose: () => void;
}

export interface CollectionsTableProps {
    totalCollectionsCount: number;
    page: number;
    onDelete?: (col: { id: string; name: string; videos: string[]; createdAt: string }) => void;
    onPageChange?: (event: unknown, page: number) => void;
    onSort?: (field: string) => void;
}
