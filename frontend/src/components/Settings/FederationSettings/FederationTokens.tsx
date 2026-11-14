import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    FormControl,
    FormControlLabel,
    FormGroup,
    FormLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { getErrorMessage } from '../../../utils/apiClient';
import { copyTextToClipboard } from '../../../utils/clipboard';
import {
    federationApi,
    type FederationScope,
    type FederationToken,
    type FederationTokenStatus,
    type FederationVisibility,
} from '../../../utils/federationApi';
import ConfirmationModal from '../../ConfirmationModal';
import DialogHeader from '../../DialogHeader';
import CredentialRevealDialog from './CredentialRevealDialog';

const TOKENS_QUERY_KEY = ['federation-tokens'];
const EXPIRY_DAYS = [30, 90, 365] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type PendingAction =
    | { kind: 'rotate' | 'revoke' | 'delete'; token: FederationToken }
    | { kind: 'resetIdentity' };

const STATUS_COLORS: Record<FederationTokenStatus, 'success' | 'warning' | 'default'> = {
    active: 'success',
    suspended: 'warning',
    expired: 'default',
    revoked: 'default',
};

/** This instance's identity and the access keys it issues to other instances. */
const FederationTokens: React.FC = () => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const queryClient = useQueryClient();
    const [createOpen, setCreateOpen] = useState(false);
    const [label, setLabel] = useState('');
    const [scopes, setScopes] = useState<FederationScope[]>(['library:read', 'media:read']);
    const [visibility, setVisibility] = useState<FederationVisibility>('public');
    const [expiryDays, setExpiryDays] = useState<number | 'never'>('never');
    const [revealed, setRevealed] = useState<string | null>(null);
    const [pending, setPending] = useState<PendingAction | null>(null);

    const { data, isLoading, isError } = useQuery({
        queryKey: TOKENS_QUERY_KEY,
        queryFn: async () => (await federationApi.listTokens()).data,
    });

    const refresh = () => void queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY });
    const fail = (error: unknown) =>
        showSnackbar(t('federationActionFailed', { error: getErrorMessage(error) }), 'error');

    const createMutation = useMutation({
        mutationFn: () =>
            federationApi.createToken({
                label: label.trim(),
                scopes,
                visibilityCeiling: visibility,
                expiresAt: expiryDays === 'never' ? null : Date.now() + expiryDays * DAY_MS,
            }),
        onSuccess: (response) => {
            setCreateOpen(false);
            setLabel('');
            setRevealed(response.data.credential);
            refresh();
        },
        onError: fail,
    });

    const runPending = async () => {
        if (!pending) return;
        try {
            if (pending.kind === 'resetIdentity') {
                const { data: reset } = await federationApi.resetIdentity();
                showSnackbar(t('federationResetIdentityDone', { count: reset.revokedTokens }), 'success');
            } else if (pending.kind === 'rotate') {
                const { data: rotated } = await federationApi.rotateToken(pending.token.id);
                setRevealed(rotated.credential);
            } else if (pending.kind === 'revoke') {
                await federationApi.revokeToken(pending.token.id);
            } else {
                await federationApi.deleteToken(pending.token.id);
            }
            refresh();
        } catch (error) {
            fail(error);
        } finally {
            setPending(null);
        }
    };

    const resume = async (token: FederationToken) => {
        try {
            await federationApi.resumeToken(token.id);
            refresh();
        } catch (error) {
            fail(error);
        }
    };

    const toggleScope = (scope: FederationScope) =>
        setScopes((current) =>
            current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]
        );

    if (isLoading) {
        return <CircularProgress size={24} />;
    }
    if (isError || !data) {
        return <Alert severity="error">{t('federationLoadError')}</Alert>;
    }

    const statusLabel: Record<FederationTokenStatus, string> = {
        active: t('federationTokenStatusActive'),
        suspended: t('federationTokenStatusSuspended'),
        expired: t('federationTokenStatusExpired'),
        revoked: t('federationTokenStatusRevoked'),
    };

    const confirmCopy: Record<PendingAction['kind'], { title: string; message: string; confirm: string }> = {
        resetIdentity: {
            title: t('federationResetIdentityTitle'),
            message: t('federationResetIdentityMessage'),
            confirm: t('federationResetIdentity'),
        },
        rotate: { title: t('federationRotate'), message: t('federationRotateConfirm'), confirm: t('federationRotate') },
        revoke: { title: t('federationRevoke'), message: t('federationRevokeConfirm'), confirm: t('federationRevoke') },
        delete: { title: t('delete'), message: t('federationDeleteTokenConfirm'), confirm: t('delete') },
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t('federationThisInstance')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" color="text.secondary">
                        {t('federationInstanceId')}:
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {data.instanceId}
                    </Typography>
                    <Tooltip title={t('federationCopy')}>
                        <IconButton
                            size="small"
                            aria-label={t('federationCopy')}
                            onClick={() =>
                                void copyTextToClipboard(data.instanceId)
                                    .catch(() => false)
                                    .then((ok) =>
                                        showSnackbar(
                                            t(ok ? 'copied' : 'federationCopyFailed'),
                                            ok ? 'success' : 'error'
                                        )
                                    )
                            }
                        >
                            <ContentCopyIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Button size="small" color="error" onClick={() => setPending({ kind: 'resetIdentity' })}>
                        {t('federationResetIdentity')}
                    </Button>
                </Box>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t('federationTokensTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    {t('federationTokensDescription')}
                </Typography>
                <Box>
                    <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
                        {t('federationCreateToken')}
                    </Button>
                </Box>
                {data.tokens.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                        {t('federationNoTokens')}
                    </Typography>
                )}
                {data.tokens.map((token) => (
                    <Box
                        key={token.id}
                        sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 600 }}>
                                {token.label || token.id}
                            </Typography>
                            <Chip size="small" label={statusLabel[token.status]} color={STATUS_COLORS[token.status]} />
                            {token.visibilityCeiling === 'owner' && (
                                <Chip size="small" color="warning" label={t('federationVisibilityOwner')} />
                            )}
                            {token.scopes.map((scope) => (
                                <Chip
                                    key={scope}
                                    size="small"
                                    variant="outlined"
                                    label={scope === 'library:read' ? t('federationScopeLibrary') : t('federationScopeMedia')}
                                />
                            ))}
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                            {token.consumerInstanceId
                                ? t('federationTokenBoundTo', { instanceId: token.consumerInstanceId })
                                : t('federationTokenUnused')}
                            {token.lastUsedAt !== null &&
                                ` · ${t('federationTokenLastUsed', { time: new Date(token.lastUsedAt).toLocaleString() })}`}
                        </Typography>
                        {token.status === 'suspended' && (
                            <Alert severity="warning">{t('federationTokenSuspendedHint')}</Alert>
                        )}
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {token.status === 'suspended' && (
                                <Button size="small" onClick={() => void resume(token)}>
                                    {t('resume')}
                                </Button>
                            )}
                            {(token.status === 'active' || token.status === 'suspended') && (
                                <>
                                    <Button size="small" onClick={() => setPending({ kind: 'rotate', token })}>
                                        {t('federationRotate')}
                                    </Button>
                                    <Button size="small" color="warning" onClick={() => setPending({ kind: 'revoke', token })}>
                                        {t('federationRevoke')}
                                    </Button>
                                </>
                            )}
                            <Button size="small" color="error" onClick={() => setPending({ kind: 'delete', token })}>
                                {t('delete')}
                            </Button>
                        </Box>
                    </Box>
                ))}
            </Box>

            <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
                <DialogHeader title={t('federationCreateToken')} onClose={() => setCreateOpen(false)} closeLabel={t('close')} />
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                    <TextField
                        label={t('federationTokenLabel')}
                        value={label}
                        onChange={(event) => setLabel(event.target.value)}
                        slotProps={{ htmlInput: { maxLength: 100 } }}
                        fullWidth
                        sx={{ mt: 1 }}
                    />
                    <FormControl component="fieldset">
                        <FormLabel component="legend">{t('federationTokenScopes')}</FormLabel>
                        <FormGroup>
                            <FormControlLabel
                                control={<Checkbox checked={scopes.includes('library:read')} onChange={() => toggleScope('library:read')} />}
                                label={t('federationScopeLibrary')}
                            />
                            <FormControlLabel
                                control={<Checkbox checked={scopes.includes('media:read')} onChange={() => toggleScope('media:read')} />}
                                label={t('federationScopeMedia')}
                            />
                        </FormGroup>
                    </FormControl>
                    <FormControl fullWidth>
                        <InputLabel id="federation-visibility-label">{t('federationVisibility')}</InputLabel>
                        <Select
                            labelId="federation-visibility-label"
                            label={t('federationVisibility')}
                            value={visibility}
                            onChange={(event) => setVisibility(event.target.value as FederationVisibility)}
                        >
                            <MenuItem value="public">{t('federationVisibilityPublic')}</MenuItem>
                            <MenuItem value="owner">{t('federationVisibilityOwner')}</MenuItem>
                        </Select>
                    </FormControl>
                    <FormControl fullWidth>
                        <InputLabel id="federation-expiry-label">{t('federationExpiry')}</InputLabel>
                        <Select
                            labelId="federation-expiry-label"
                            label={t('federationExpiry')}
                            value={expiryDays}
                            onChange={(event) => setExpiryDays(event.target.value as number | 'never')}
                        >
                            <MenuItem value="never">{t('never')}</MenuItem>
                            {EXPIRY_DAYS.map((days) => (
                                <MenuItem key={days} value={days}>
                                    {t('federationExpiryDays', { days })}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
                    <Button
                        variant="contained"
                        disabled={scopes.length === 0 || createMutation.isPending}
                        onClick={() => createMutation.mutate()}
                    >
                        {t('federationCreateToken')}
                    </Button>
                </DialogActions>
            </Dialog>

            <CredentialRevealDialog credential={revealed} onClose={() => setRevealed(null)} />

            {pending && (
                <ConfirmationModal
                    isOpen
                    onClose={() => setPending(null)}
                    onConfirm={runPending}
                    title={confirmCopy[pending.kind].title}
                    message={confirmCopy[pending.kind].message}
                    confirmText={confirmCopy[pending.kind].confirm}
                    cancelText={t('cancel')}
                    isDanger={pending.kind !== 'rotate'}
                />
            )}
        </Box>
    );
};

export default FederationTokens;
