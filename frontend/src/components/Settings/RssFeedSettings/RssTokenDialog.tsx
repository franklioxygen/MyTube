import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { CreateTokenInput, RssFilters, RssToken, UpdateTokenInput } from '../../../utils/rssApi';
import RssFilterEditor from './RssFilterEditor';

interface VideoOption {
    channelUrl: string;
    author: string;
}

interface RssTokenDialogProps {
    open: boolean;
    mode: 'create' | 'edit';
    token?: RssToken;
    channelOptions?: VideoOption[];
    authorOptions?: string[];
    tagOptions?: string[];
    onClose: () => void;
    onCreate?: (input: CreateTokenInput) => void;
    onUpdate?: (id: string, patch: UpdateTokenInput) => void;
    isLoading?: boolean;
}

const DEFAULT_FILTERS: RssFilters = { maxItems: 50 };

const RssTokenDialog: React.FC<RssTokenDialogProps> = ({
    open,
    mode,
    token,
    channelOptions = [],
    authorOptions = [],
    tagOptions = [],
    onClose,
    onCreate,
    onUpdate,
    isLoading = false,
}) => {
    const { t } = useLanguage();
    const [label, setLabel] = useState('');
    const [role, setRole] = useState<'admin' | 'visitor'>('visitor');
    const [filters, setFilters] = useState<RssFilters>(DEFAULT_FILTERS);

    useEffect(() => {
        if (open) {
            if (mode === 'edit' && token) {
                setLabel(token.label);
                setRole(token.role);
                setFilters({ maxItems: 50, ...token.filters });
            } else {
                setLabel('');
                setRole('visitor');
                setFilters(DEFAULT_FILTERS);
            }
        }
    }, [open, mode, token]);

    const showAdminWarning = role === 'admin';

    const handleSubmit = () => {
        if (mode === 'create') {
            onCreate?.({ label, role, filters });
        } else if (mode === 'edit' && token) {
            onUpdate?.(token.id, { label, filters });
        }
    };

    const title = mode === 'create' ? t('rssCreateToken') : t('rssEditToken');

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    {/* Label */}
                    <TextField
                        label={t('rssLabel')}
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        size="small"
                        fullWidth
                        placeholder={t('rssLabelPlaceholder')}
                    />

                    {/* Role is only editable on create */}
                    {mode === 'create' && (
                        <Box>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                {t('rssRole')}
                            </Typography>
                            <Select
                                size="small"
                                value={role}
                                onChange={(e) => setRole(e.target.value as 'admin' | 'visitor')}
                                fullWidth
                            >
                                <MenuItem value="visitor">visitor</MenuItem>
                                <MenuItem value="admin">admin</MenuItem>
                            </Select>
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ mt: 0.5, display: 'block' }}
                            >
                                {t('rssRoleDescription')}
                            </Typography>
                        </Box>
                    )}

                    {mode === 'edit' && token && (
                        <Typography variant="body2" color="text.secondary">
                            {t('rssRoleCannotChange', { role: token.role })}
                        </Typography>
                    )}

                    {showAdminWarning && (
                        <Alert severity="warning">{t('rssAdminRoleWarning')}</Alert>
                    )}

                    <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
                        {t('rssPublicAggregatorWarning')}
                    </Alert>

                    {/* Filters */}
                    <Typography variant="subtitle2">{t('rssFilters')}</Typography>
                    <RssFilterEditor
                        filters={filters}
                        onChange={setFilters}
                        channelOptions={channelOptions}
                        authorOptions={authorOptions}
                        tagOptions={tagOptions}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={isLoading}>
                    {t('cancel')}
                </Button>
                <Button onClick={handleSubmit} variant="contained" disabled={isLoading}>
                    {mode === 'create' ? t('rssCreateToken') : t('save')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default RssTokenDialog;
