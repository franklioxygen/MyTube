// Type definitions for ManagePage.test.tsx mock captured props
import type { Collection, Video } from '../../types';

export interface CapturedVideosTableProps {
    displayedVideos: Video[];
    totalVideosCount: number;
    searchTerm: string;
    page: number;
    totalSize: number;
    order: 'asc' | 'desc';
    isRefreshingFileSizes: boolean;
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
    displayedCollections: Collection[];
    totalCollectionsCount: number;
    page: number;
    getCollectionSize: (videoIds: string[]) => string;
    onDelete?: (col: Collection) => void;
    onUpdate: (id: string, name: string) => Promise<void>;
    onPageChange?: (event: unknown, page: number) => void;
    onSort?: (field: string) => void;
}
