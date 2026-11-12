import { getApiErrorMessage } from '../../utils/errors';
import { Check, CleaningServices, Close, Delete, Edit, Folder } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    IconButton,
    Link,
    Pagination,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery
} from '@mui/material';
import React, { useCallback, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { usePaginationSwipeNavigation } from '../../hooks/usePaginationSwipeNavigation';
import { Collection } from '../../types';
import { formatDisplayDate } from '../../utils/formatUtils';

type CollectionSortBy = 'name' | 'videoCount' | 'size' | 'createdAt';

interface CollectionsTableProps {
    displayedCollections: Collection[];
    totalCollectionsCount: number;
    onDelete: (collection: Collection) => void;
    onUpdate: (id: string, name: string) => Promise<void>;
    page: number;
    totalPages: number;
    onPageChange: (event: React.ChangeEvent<unknown>, value: number) => void;
    getCollectionSize: (videoIds: string[]) => string;
    orderBy: CollectionSortBy;
    order: 'asc' | 'desc';
    onSort: (property: CollectionSortBy) => void;
    emptyCollectionsCount: number;
    onCleanupEmpty: () => void;
    isCleaningUpEmpty: boolean;
}

const CollectionsTable: React.FC<CollectionsTableProps> = ({
    displayedCollections,
    totalCollectionsCount,
    onDelete,
    onUpdate,
    page,
    totalPages,
    onPageChange,
    getCollectionSize,
    orderBy,
    order,
    onSort,
    emptyCollectionsCount,
    onCleanupEmpty,
    isCleaningUpEmpty
}) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const { showSnackbar } = useSnackbar();
    const isVisitor = userRole === 'visitor';
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    // Same swipe-to-page as the videos table; it stands down while the table is
    // wide enough to scroll sideways on its own.
    const goToPage = useCallback(
        (value: number) => onPageChange({} as React.ChangeEvent<unknown>, value),
        [onPageChange]
    );
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const swipeHandlers = usePaginationSwipeNavigation({
        page,
        totalPages,
        onPageChange: goToPage,
        keepNativeHorizontalPan: true,
        surfaceRef: tableContainerRef
    });

    // Edit state
    const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
    const [editName, setEditName] = useState<string>('');
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [nameError, setNameError] = useState<string>('');

    // Validate collection name
    const validateName = (name: string): string | null => {
        const trimmed = name.trim();

        if (trimmed.length === 0) {
            return t('collectionNameRequired') || 'Collection name is required';
        }

        if (trimmed.length > 200) {
            return t('collectionNameTooLong') || 'Collection name must be 200 characters or less';
        }

        // Check for invalid filesystem characters
        // eslint-disable-next-line no-control-regex
        const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
        if (invalidChars.test(trimmed)) {
            return t('collectionNameInvalidChars') || 'Collection name contains invalid characters';
        }

        // Check for reserved names (Windows)
        const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
        if (reservedNames.includes(trimmed.toUpperCase())) {
            return t('collectionNameReserved') || 'Collection name is reserved';
        }

        return null;
    };

    const handleEditClick = (collection: Collection) => {
        setEditingCollectionId(collection.id);
        setEditName(collection.name);
        setNameError('');
    };

    const handleCancelEdit = () => {
        setEditingCollectionId(null);
        setEditName('');
        setNameError('');
    };

    const handleNameChange = (value: string) => {
        setEditName(value);
        // Clear error when user starts typing
        if (nameError) {
            setNameError('');
        }
    };

    const handleSave = async (id: string) => {
        const trimmedName = editName.trim();

        // Validate name
        const error = validateName(trimmedName);
        if (error) {
            setNameError(error);
            showSnackbar(error, 'error');
            return;
        }

        setIsSaving(true);
        setNameError('');
        try {
            await onUpdate(id, trimmedName);
            setEditingCollectionId(null);
            setEditName('');
        } catch (error: unknown) {
            const errorMessage = getApiErrorMessage(error) || t('failedToUpdateCollection') || 'Failed to update collection';
            setNameError(errorMessage);
            showSnackbar(errorMessage, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Box sx={{ mb: 6 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', fontSize: { xs: '1.125rem', sm: '1.5rem' } }}>
                    <Folder sx={{ mr: 1, color: 'secondary.main' }} />
                    {t('collections')} ({totalCollectionsCount})
                </Typography>
                {!isVisitor && (
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<CleaningServices />}
                        onClick={onCleanupEmpty}
                        loading={isCleaningUpEmpty}
                        loadingPosition="start"
                        disabled={emptyCollectionsCount === 0}
                    >
                        {t('cleanup')}
                    </Button>
                )}
            </Box>

            {totalCollectionsCount > 0 ? (
                <TableContainer component={Paper} variant="outlined" ref={tableContainerRef} {...swipeHandlers}>
                    <Table sx={{ display: { xs: 'block', md: 'table' } }}>
                        <TableHead sx={{ display: { xs: 'block', md: 'table-header-group' } }}>
                            <TableRow sx={{
                                display: { xs: 'flex', md: 'table-row' },
                                alignItems: 'center', flexWrap: 'wrap',
                                px: { xs: 1, md: 0 }, py: { xs: 0.5, md: 0 },
                                borderBottomWidth: { xs: 1, md: 0 }, borderBottomStyle: 'solid', borderColor: 'divider',
                                '& > th': {
                                    px: { xs: 0.5, md: 2 }, py: { xs: 0.5, md: 2 },
                                    borderBottomWidth: { xs: 0, md: 1 }, borderColor: 'divider',
                                },
                                '& .MuiTableSortLabel-root': { whiteSpace: 'nowrap', fontSize: { xs: '0.8125rem', md: '0.875rem' } },
                                '& .MuiTableSortLabel-icon': { width: { xs: 14, md: 18 }, ml: { xs: 0.25, md: 0.5 }, mr: { xs: 0, md: 0.5 } },
                            }}>
                                <TableCell>
                                    <TableSortLabel
                                        active={orderBy === 'name'}
                                        direction={orderBy === 'name' ? order : 'asc'}
                                        onClick={() => onSort('name')}
                                    >
                                        {t('name')}
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        active={orderBy === 'videoCount'}
                                        direction={orderBy === 'videoCount' ? order : 'asc'}
                                        onClick={() => onSort('videoCount')}
                                    >
                                        {t('videos')}
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        active={orderBy === 'size'}
                                        direction={orderBy === 'size' ? order : 'asc'}
                                        onClick={() => onSort('size')}
                                    >
                                        {t('size')}
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        active={orderBy === 'createdAt'}
                                        direction={orderBy === 'createdAt' ? order : 'asc'}
                                        onClick={() => onSort('createdAt')}
                                    >
                                        {t('created')}
                                    </TableSortLabel>
                                </TableCell>
                                {!isVisitor && <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('actions')}</TableCell>}
                            </TableRow>
                        </TableHead>
                        <TableBody sx={{ display: { xs: 'block', md: 'table-row-group' } }}>
                            {displayedCollections.map(collection => (
                                <TableRow key={collection.id} hover sx={{
                                    display: { xs: 'grid', md: 'table-row' },
                                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                                    gridTemplateAreas: isVisitor
                                        ? '"name name" "count size" "created created"'
                                        : '"name name" "count size" "created actions"',
                                    columnGap: 1.5, rowGap: 1,
                                    p: { xs: 1.5, md: 0 },
                                    borderBottomWidth: { xs: 1, md: 0 }, borderBottomStyle: 'solid', borderColor: 'divider',
                                    '&:last-child': { borderBottom: 0 },
                                    '& > th, & > td': {
                                        minWidth: 0, p: { xs: 0, md: 2 },
                                        borderBottomWidth: { xs: 0, md: 1 }, borderColor: 'divider',
                                    },
                                }}>
                                    <TableCell component="th" scope="row" sx={{ fontWeight: 500, gridArea: 'name' }}>
                                        {editingCollectionId === collection.id ? (
                                            <Box sx={{
                                                display: { xs: 'grid', md: 'flex' }, alignItems: 'center',
                                                gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                                            }}>
                                                <TextField
                                                    value={editName}
                                                    onChange={(e) => handleNameChange(e.target.value)}
                                                    size="small"
                                                    fullWidth
                                                    sx={{ minWidth: 0, gridColumn: '1 / -1' }}
                                                    autoFocus
                                                    error={!!nameError}
                                                    helperText={nameError}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleSave(collection.id);
                                                        if (e.key === 'Escape') handleCancelEdit();
                                                    }}
                                                    disabled={isSaving}
                                                    slotProps={{ htmlInput: { maxLength: 200 } }}
                                                />
                                                <IconButton
                                                    size="small"
                                                    color="primary"
                                                    onClick={() => handleSave(collection.id)}
                                                    loading={isSaving}
                                                    aria-label="save collection name"
                                                    sx={{ gridColumn: 2 }}
                                                >
                                                    <Check />
                                                </IconButton>
                                                <IconButton
                                                    size="small"
                                                    color="error"
                                                    onClick={handleCancelEdit}
                                                    disabled={isSaving}
                                                    aria-label="cancel edit"
                                                >
                                                    <Close />
                                                </IconButton>
                                            </Box>
                                        ) : (
                                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: { xs: 0.5, md: 0 } }}>
                                                {!isVisitor && (
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleEditClick(collection)}
                                                        sx={{ order: { xs: 1, md: 0 }, flexShrink: 0, mr: { xs: 0, md: 1 }, opacity: 0.6, '&:hover': { opacity: 1 } }}
                                                        aria-label="edit collection"
                                                    >
                                                        <Edit fontSize="small" />
                                                    </IconButton>
                                                )}
                                                <Link
                                                    component={RouterLink}
                                                    to={`/collection/${collection.id}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    sx={{
                                                        color: 'inherit',
                                                        textDecoration: 'none',
                                                        cursor: 'pointer',
                                                        flex: 1, minWidth: 0, overflowWrap: 'anywhere',
                                                        '&:hover': { textDecoration: 'underline' }
                                                    }}
                                                >
                                                    {collection.name}
                                                </Link>
                                            </Box>
                                        )}
                                    </TableCell>
                                    <TableCell sx={{ gridArea: 'count', color: { xs: 'text.secondary', md: 'text.primary' } }}>
                                        <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>{t('videos')}: </Box>
                                        <Box component="span">{collection.videos.length}</Box>
                                    </TableCell>
                                    <TableCell sx={{ gridArea: 'size', justifySelf: 'end', whiteSpace: 'nowrap', color: { xs: 'text.secondary', md: 'text.primary' } }}>
                                        <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>{t('size')}: </Box>
                                        <Box component="span">{getCollectionSize(collection.videos)}</Box>
                                    </TableCell>
                                    <TableCell sx={{ gridArea: 'created', alignSelf: 'center', color: { xs: 'text.secondary', md: 'text.primary' } }}>
                                        <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>{t('created')}: </Box>
                                        <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{formatDisplayDate(collection.createdAt)}</Box>
                                    </TableCell>
                                    {!isVisitor && (
                                        <TableCell align="right" sx={{ gridArea: 'actions', justifySelf: 'end' }}>
                                            <Tooltip title={t('deleteCollection')} disableHoverListener={isTouch}>
                                                <IconButton
                                                    color="error"
                                                    onClick={() => onDelete(collection)}
                                                    size="small"
                                                    disabled={editingCollectionId === collection.id}
                                                >
                                                    <Delete />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    )}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            ) : (
                <Alert severity="info" variant="outlined">{t('noCollections')}</Alert>
            )}

            {totalPages > 1 && (
                <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                    <Pagination
                        count={totalPages}
                        page={page}
                        onChange={onPageChange}
                        color="secondary"
                        showFirstButton
                        showLastButton
                    />
                </Box>
            )}
        </Box>
    );
};

export default CollectionsTable;
