import { Close, Subtitles, SubtitlesOff } from '@mui/icons-material';
import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    Menu,
    MenuItem,
    Tooltip,
    Typography,
    useMediaQuery
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { getSubtitleLanguageLabel } from '../../../utils/formatUtils';

interface SubtitleControlProps {
    subtitles: Array<{ language: string; filename: string; path: string }>;
    subtitlesEnabled: boolean;
    selectedSubtitleIndices: number[];
    subtitleMenuAnchor: HTMLElement | null;
    onSubtitleClick: (event: React.MouseEvent<HTMLElement>) => void;
    onCloseMenu: () => void;
    onSelectSubtitle: (index: number) => void;
    showOnMobile?: boolean;
    onUploadSubtitle?: (file: File) => void;
    onDeleteSubtitle?: (index: number) => void | Promise<void>;
    isFullscreen?: boolean;
}

const SubtitleControl: React.FC<SubtitleControlProps> = ({
    subtitles,
    subtitlesEnabled,
    selectedSubtitleIndices,
    subtitleMenuAnchor,
    onSubtitleClick,
    onCloseMenu,
    onSelectSubtitle,
    showOnMobile = false,
    onUploadSubtitle,
    onDeleteSubtitle,
    isFullscreen = false
}) => {
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [indexToDelete, setIndexToDelete] = useState<number | null>(null);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && onUploadSubtitle) {
            onUploadSubtitle(file);
            onCloseMenu();
        }
        // Reset input
        if (event.target) {
            event.target.value = '';
        }
    };

    const handleDeleteClick = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        setIndexToDelete(index);
        setDeleteModalOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (indexToDelete === null || !onDeleteSubtitle) return;
        await onDeleteSubtitle(indexToDelete);
        setDeleteModalOpen(false);
        setIndexToDelete(null);
        onCloseMenu();
    };

    const handleCloseDeleteModal = () => {
        setDeleteModalOpen(false);
        setIndexToDelete(null);
    };

    const hasSubtitles = Boolean(subtitles?.length);
    const showControl = hasSubtitles || onUploadSubtitle;
    if (!showControl) return null;

    return (
        <>
            <Tooltip title={subtitlesEnabled ? 'Subtitles' : 'Subtitles Off'} disableHoverListener={isTouch}>
                <IconButton
                    color={subtitlesEnabled ? "primary" : "default"}
                    onClick={onSubtitleClick}
                    size="small"
                    sx={showOnMobile ? { display: { xs: 'flex', sm: 'none' }, ml: { xs: 0.25, sm: 0.5 } } : {}}
                >
                    {subtitlesEnabled ? <Subtitles /> : <SubtitlesOff />}
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={subtitleMenuAnchor}
                open={Boolean(subtitleMenuAnchor)}
                onClose={onCloseMenu}
                container={isFullscreen ? document.fullscreenElement as HTMLElement : undefined}
            >
                {hasSubtitles && (
                    <MenuItem onClick={() => onSelectSubtitle(-1)}>
                        {t('off') || 'Off'}
                    </MenuItem>
                )}
                {subtitles?.map((subtitle, index) => {
                    const isChecked = selectedSubtitleIndices.includes(index);
                    const isDisabled = !isChecked && selectedSubtitleIndices.length >= 2;
                    return (
                        <MenuItem
                            key={`${subtitle.language}-${index}`}
                            onClick={() => onSelectSubtitle(index)}
                            disabled={isDisabled}
                            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        >
                            <Checkbox
                                checked={isChecked}
                                size="small"
                                disableRipple
                                sx={{ p: 0, mr: 1 }}
                                onClick={(e) => e.stopPropagation()}
                            />
                            <span style={{ flex: 1 }}>{getSubtitleLanguageLabel(subtitle.language, subtitle.path)}</span>
                            {onDeleteSubtitle && (
                                <IconButton
                                    size="small"
                                    onClick={(e) => handleDeleteClick(e, index)}
                                    sx={{ ml: 0.5 }}
                                    aria-label={t('delete') || 'Delete'}
                                >
                                    <Close fontSize="small" />
                                </IconButton>
                            )}
                        </MenuItem>
                    );
                })}
                {onUploadSubtitle && [
                    <MenuItem key="upload" onClick={handleUploadClick}>
                        {t('uploadSubtitle') || 'Upload Subtitle'}
                    </MenuItem>,
                    <input
                        key="file-input"
                        type="file"
                        accept=".vtt,.srt,.ass,.ssa"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />
                ]}
            </Menu>
            <Dialog
                open={deleteModalOpen}
                onClose={handleCloseDeleteModal}
                aria-labelledby="delete-subtitle-dialog-title"
                aria-describedby="delete-subtitle-dialog-description"
                slotProps={{
                    paper: {
                        sx: {
                            borderRadius: 2,
                            minWidth: 300,
                            maxWidth: 500,
                            backgroundImage: 'none'
                        }
                    }
                }}
            >
                <DialogTitle
                    id="delete-subtitle-dialog-title"
                    sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                    <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                        {t('confirm') || 'Confirm'}
                    </Typography>
                    <IconButton
                        aria-label="close"
                        onClick={handleCloseDeleteModal}
                        sx={{ color: (theme) => theme.palette.grey[500] }}
                    >
                        <Close />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    <DialogContentText id="delete-subtitle-dialog-description" sx={{ color: 'text.primary' }}>
                        {t('confirmDeleteSubtitle') || 'Delete this subtitle?'}
                    </DialogContentText>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={handleCloseDeleteModal} color="inherit" variant="text">
                        {t('cancel') || 'Cancel'}
                    </Button>
                    <Button onClick={handleConfirmDelete} color="error" variant="outlined" autoFocus>
                        {t('delete') || 'Delete'}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default SubtitleControl;

