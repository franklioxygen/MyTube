// Type definitions for VideoPlayer.test.tsx mock captured props
// Extracted to reduce global scope complexity (lizard nloc/ccn)

export interface MockDeleteMutation {
    isPending: boolean;
    error: { message?: string } | null;
    mutateAsync: ReturnType<typeof import('vitest').vi.fn>;
}

export interface MockVideoMutationsReturn extends Record<string, unknown> {
    deleteMutation: MockDeleteMutation;
    _onDeleteSuccess: ((data: unknown) => void) | undefined;
}

export interface CapturedVideoControlsProps extends Record<string, unknown> {
    onEnded: () => void;
    onToggleCinemaMode: () => void;
    isCinemaMode: boolean;
    autoPlay: boolean;
    startTime: number;
}

export interface CapturedVideoInfoProps extends Record<string, unknown> {
    onAuthorClick: () => void;
    onAvatarClick: () => void;
    onDelete: () => void;
    onUnsubscribe: () => void;
    onRatingChange: (value: number) => Promise<void>;
    onTitleSave: (title: string) => Promise<void>;
    onTagsUpdate: (tags: string[]) => Promise<void>;
    onToggleVisibility: () => Promise<void>;
    onCollectionClick: (id: string) => void;
    isDeleting: boolean;
    deleteError: string | null;
    availableTags: string[];
    isSubscribed: boolean;
}

export interface CapturedCommentsSectionProps extends Record<string, unknown> {
    onToggleComments: () => void;
    showComments: boolean;
}

export interface CapturedUpNextSidebarProps extends Record<string, unknown> {
    onAutoPlayNextChange: (value: boolean) => void;
    onVideoClick: (id: string) => void;
    autoPlayNext: boolean;
}

export interface CapturedCollectionModalProps extends Record<string, unknown> {
    onRemoveFromCollection: () => void;
}

export interface CapturedConfirmationModalProps extends Record<string, unknown> {
    onConfirm: () => void | Promise<void>;
    onClose: () => void;
    isOpen: boolean;
    title: string;
    isDanger: boolean;
}

export interface CapturedSubscribeModalProps extends Record<string, unknown> {
    onClose: () => void;
    onConfirm: () => void;
    open: boolean;
    authorName: string;
    url: string;
    source: string;
}
