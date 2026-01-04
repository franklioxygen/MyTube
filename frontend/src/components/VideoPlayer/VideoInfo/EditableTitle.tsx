import { Check, Close, Edit, ExpandLess, ExpandMore } from '@mui/icons-material';
import { Box, Button, TextField, Tooltip, Typography, useMediaQuery } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useAuth } from '../../../contexts/AuthContext';

interface EditableTitleProps {
    title: string;
    onSave: (newTitle: string) => Promise<void>;
}

const EditableTitle: React.FC<EditableTitleProps> = ({ title, onSave }) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
    const [editedTitle, setEditedTitle] = useState<string>('');
    const [isTitleExpanded, setIsTitleExpanded] = useState(false);
    const [showExpandButton, setShowExpandButton] = useState(false);
    const titleRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        const checkOverflow = () => {
            const element = titleRef.current;
            if (element && !isTitleExpanded) {
                setShowExpandButton(element.scrollHeight > element.clientHeight);
            }
        };

        checkOverflow();
        window.addEventListener('resize', checkOverflow);
        return () => window.removeEventListener('resize', checkOverflow);
    }, [title, isTitleExpanded]);

    const handleStartEditingTitle = () => {
        setEditedTitle(title);
        setIsEditingTitle(true);
    };

    const handleCancelEditingTitle = () => {
        setIsEditingTitle(false);
        setEditedTitle('');
    };

    const handleSaveTitle = async () => {
        if (!editedTitle.trim()) return;
        await onSave(editedTitle);
        setIsEditingTitle(false);
    };

    if (isEditingTitle) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
                <TextField
                    fullWidth
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    variant="outlined"
                    size="small"
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            handleSaveTitle();
                        }
                    }}
                />
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleSaveTitle}
                    sx={{ minWidth: 'auto', p: 0.5 }}
                >
                    <Check />
                </Button>
                <Button
                    variant="outlined"
                    color="secondary"
                    onClick={handleCancelEditingTitle}
                    sx={{ minWidth: 'auto', p: 0.5 }}
                >
                    <Close />
                </Button>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}>
            <Typography
                ref={titleRef}
                variant="h5"
                component="h1"
                fontWeight="bold"
                onClick={() => showExpandButton && setIsTitleExpanded(!isTitleExpanded)}
                sx={{
                    mr: 1,
                    display: '-webkit-box',
                    overflow: 'hidden',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: isTitleExpanded ? 'unset' : 2,
                    wordBreak: 'break-word',
                    flex: 1,
                    cursor: showExpandButton ? 'pointer' : 'default'
                }}
            >
                {title}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {!isVisitor && (
                    <Tooltip title={t('editTitle')} disableHoverListener={isTouch}>
                        <Button
                            size="small"
                            onClick={handleStartEditingTitle}
                            sx={{ minWidth: 'auto', p: 0.5, color: 'text.secondary' }}
                        >
                            <Edit fontSize="small" />
                        </Button>
                    </Tooltip>
                )}
                {showExpandButton && (
                    <Tooltip title={isTitleExpanded ? t('collapse') : t('expand')} disableHoverListener={isTouch}>
                        <Button
                            size="small"
                            onClick={() => setIsTitleExpanded(!isTitleExpanded)}
                            sx={{ minWidth: 'auto', p: 0.5, color: 'text.secondary' }}
                        >
                            {isTitleExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                        </Button>
                    </Tooltip>
                )}
            </Box>
        </Box>
    );
};

export default EditableTitle;

