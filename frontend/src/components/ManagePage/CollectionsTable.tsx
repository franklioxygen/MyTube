import { Check, Close, Delete, Edit, Folder } from '@mui/icons-material';
import {
    Alert,
    Box,
    CircularProgress,
    IconButton,
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
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { Collection } from '../../types';

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
    onSort
}) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const { showSnackbar } = useSnackbar();
    const isVisitor = userRole === 'visitor';
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

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
        } catch (error: any) {
            const errorMessage = error?.message || error?.response?.data?.error || t('failedToUpdateCollection') || 'Failed to update collection';
            setNameError(errorMessage);
            showSnackbar(errorMessage, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Box sx={{ mb: 6 }}>
            <Typography variant="h5" sx={{ mb: 2, display: 'flex', alignItems: 'center' }}>
                <Folder sx={{ mr: 1, color: 'secondary.main' }} />
                {t('collections')} ({totalCollectionsCount})
            </Typography>

            {totalCollectionsCount > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                    <Table>
                        <TableHead>
                            <TableRow>
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
                                {!isVisitor && <TableCell align="right">{t('actions')}</TableCell>}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {displayedCollections.map(collection => (
                                <TableRow key={collection.id} hover>
                                    <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                                        {editingCollectionId === collection.id ? (
                                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                <TextField
                                                    value={editName}
                                                    onChange={(e) => handleNameChange(e.target.value)}
                                                    size="small"
                                                    fullWidth
                                                    autoFocus
                                                    error={!!nameError}
                                                    helperText={nameError}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleSave(collection.id);
                                                        if (e.key === 'Escape') handleCancelEdit();
                                                    }}
                                                    disabled={isSaving}
                                                    inputProps={{ maxLength: 200 }}
                                                />
                                                <IconButton
                                                    size="small"
                                                    color="primary"
                                                    onClick={() => handleSave(collection.id)}
                                                    disabled={isSaving}
                                                    aria-label="save collection name"
                                                >
                                                    {isSaving ? <CircularProgress size={20} /> : <Check />}
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
                                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                {!isVisitor && (
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleEditClick(collection)}
                                                        sx={{ mr: 1, opacity: 0.6, '&:hover': { opacity: 1 } }}
                                                        aria-label="edit collection"
                                                    >
                                                        <Edit fontSize="small" />
                                                    </IconButton>
                                                )}
                                                {collection.name}
                                            </Box>
                                        )}
                                    </TableCell>
                                    <TableCell>{collection.videos.length} videos</TableCell>
                                    <TableCell>{getCollectionSize(collection.videos)}</TableCell>
                                    <TableCell>{new Date(collection.createdAt).toLocaleDateString()}</TableCell>
                                    {!isVisitor && (
                                        <TableCell align="right">
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
