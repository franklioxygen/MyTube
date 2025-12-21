import { Delete, Folder } from '@mui/icons-material';
import {
    Alert,
    Box,
    IconButton,
    Pagination,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
    useMediaQuery
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useVisitorMode } from '../../contexts/VisitorModeContext';
import { Collection } from '../../types';

interface CollectionsTableProps {
    displayedCollections: Collection[];
    totalCollectionsCount: number;
    onDelete: (collection: Collection) => void;
    page: number;
    totalPages: number;
    onPageChange: (event: React.ChangeEvent<unknown>, value: number) => void;
    getCollectionSize: (videoIds: string[]) => string;
}

const CollectionsTable: React.FC<CollectionsTableProps> = ({
    displayedCollections,
    totalCollectionsCount,
    onDelete,
    page,
    totalPages,
    onPageChange,
    getCollectionSize
}) => {
    const { t } = useLanguage();
    const { visitorMode } = useVisitorMode();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

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
                                <TableCell>{t('name')}</TableCell>
                                <TableCell>{t('videos')}</TableCell>
                                <TableCell>{t('size')}</TableCell>
                                <TableCell>{t('created')}</TableCell>
                                {!visitorMode && <TableCell align="right">{t('actions')}</TableCell>}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {displayedCollections.map(collection => (
                                <TableRow key={collection.id} hover>
                                    <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                                        {collection.name}
                                    </TableCell>
                                    <TableCell>{collection.videos.length} videos</TableCell>
                                    <TableCell>{getCollectionSize(collection.videos)}</TableCell>
                                    <TableCell>{new Date(collection.createdAt).toLocaleDateString()}</TableCell>
                                    {!visitorMode && (
                                        <TableCell align="right">
                                            <Tooltip title={t('deleteCollection')} disableHoverListener={isTouch}>
                                                <IconButton
                                                    color="error"
                                                    onClick={() => onDelete(collection)}
                                                    size="small"
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
