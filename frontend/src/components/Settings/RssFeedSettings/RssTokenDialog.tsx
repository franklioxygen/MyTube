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
import type { SelectChangeEvent } from '@mui/material/Select';
import React, { useState } from 'react';
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
    onCreate?: (input: CreateTokenInput) => void | Promise<unknown>;
    onUpdate?: (id: string, patch: UpdateTokenInput) => void | Promise<unknown>;
    isLoading?: boolean;
}

const DEFAULT_FILTERS: RssFilters = { maxItems: 50 };

const getInitialLabel = (mode: RssTokenDialogProps['mode'], token?: RssToken): string =>
    mode === 'edit' && token ? token.label : '';

const getInitialRole = (mode: RssTokenDialogProps['mode'], token?: RssToken): 'admin' | 'visitor' =>
    mode === 'edit' && token ? token.role : 'visitor';

const getInitialFilters = (mode: RssTokenDialogProps['mode'], token?: RssToken): RssFilters =>
    mode === 'edit' && token ? { maxItems: 50, ...token.filters } : { ...DEFAULT_FILTERS };

const RssTokenDialogContent: React.FC<RssTokenDialogProps> = ({
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
    const [label, setLabel] = useState(() => getInitialLabel(mode, token));
    const [role, setRole] = useState<'admin' | 'visitor'>(() => getInitialRole(mode, token));
    const [filters, setFilters] = useState<RssFilters>(() => getInitialFilters(mode, token));

    const showAdminWarning = role === 'admin';

    const handleSubmit = () => {
        if (mode === 'create') {
            onCreate?.({ label, role, filters });
        } else if (mode === 'edit' && token) {
            onUpdate?.(token.id, { label, filters });
        }
    };

    const handleLabelChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setLabel(event.target.value);
    };

    const handleRoleChange = (event: SelectChangeEvent<'admin' | 'visitor'>) => {
        setRole(event.target.value as 'admin' | 'visitor');
    };

    const title = mode === 'create' ? t('rssCreateToken') : t('rssEditToken');

    return (
        <Dialog
            open={open}
            onClose={() => {
                if (!isLoading) {
                    onClose();
                }
            }}
            disableEscapeKeyDown={isLoading}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    <TextField
                        label={t('rssLabel')}
                        value={label}
                        onChange={handleLabelChange}
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
                                onChange={handleRoleChange}
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
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    loading={isLoading}
                    loadingPosition="start"
                >
                    {mode === 'create' ? t('rssCreateToken') : t('save')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const RssTokenDialog: React.FC<RssTokenDialogProps> = (props) => {
    if (!props.open) {
        return null;
    }

    return (
        <RssTokenDialogContent
            key={`${props.mode}:${props.token?.id ?? 'new'}`}
            {...props}
        />
    );
};

export default RssTokenDialog;
