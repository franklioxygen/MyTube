import AddIcon from '@mui/icons-material/Add';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    FormControlLabel,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { getErrorMessage } from '../../../utils/apiClient';
import {
    federationApi,
    type FederationPeer,
    type FederationPeerStatus,
} from '../../../utils/federationApi';
import ConfirmationModal from '../../ConfirmationModal';
import DialogHeader from '../../DialogHeader';

const PEERS_QUERY_KEY = ['federation-peers'];

const STATUS_COLORS: Record<FederationPeerStatus, 'success' | 'warning' | 'error' | 'default'> = {
    pending: 'default',
    ok: 'success',
    error: 'warning',
    credential_rejected: 'error',
    credential_missing: 'error',
    identity_mismatch: 'error',
    incompatible: 'error',
};

type CredentialForm = { mode: 'add' } | { mode: 'replace'; peer: FederationPeer };

/** Other instances this one reads from. */
const FederationPeers: React.FC = () => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const queryClient = useQueryClient();
    const [form, setForm] = useState<CredentialForm | null>(null);
    const [name, setName] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [credential, setCredential] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [busyPeer, setBusyPeer] = useState<string | null>(null);
    const [removing, setRemoving] = useState<FederationPeer | null>(null);

    const { data, isLoading, isError } = useQuery({
        queryKey: PEERS_QUERY_KEY,
        queryFn: async () => (await federationApi.listPeers()).data.peers,
    });

    const refresh = () => void queryClient.invalidateQueries({ queryKey: PEERS_QUERY_KEY });
    const fail = (error: unknown) =>
        showSnackbar(t('federationActionFailed', { error: getErrorMessage(error) }), 'error');

    const openForm = (next: CredentialForm) => {
        setName('');
        setBaseUrl('');
        setCredential('');
        setForm(next);
    };

    const submitForm = async () => {
        if (!form) return;
        setSubmitting(true);
        try {
            if (form.mode === 'add') {
                await federationApi.addPeer({ name: name.trim(), baseUrl: baseUrl.trim(), credential: credential.trim() });
                showSnackbar(t('federationPeerAdded'), 'success');
            } else {
                await federationApi.replacePeerCredential(form.peer.id, credential.trim());
                showSnackbar(t('federationReplaceCredentialDone'), 'success');
            }
            setForm(null);
            refresh();
        } catch (error) {
            fail(error);
        } finally {
            setSubmitting(false);
        }
    };

    const withPeer = async (peer: FederationPeer, work: () => Promise<void>) => {
        setBusyPeer(peer.id);
        try {
            await work();
        } catch (error) {
            fail(error);
        } finally {
            setBusyPeer(null);
            refresh();
        }
    };

    const syncNow = (peer: FederationPeer) =>
        withPeer(peer, async () => {
            const { data: synced } = await federationApi.syncPeer(peer.id);
            if (synced.result.status === 'ok') {
                showSnackbar(t('federationSyncDone', { name: peer.name }), 'success');
            } else {
                showSnackbar(
                    t('federationSyncFailed', { name: peer.name, error: synced.result.error ?? synced.result.status }),
                    'error'
                );
            }
        });

    const setEnabled = (peer: FederationPeer, enabled: boolean) =>
        withPeer(peer, async () => {
            await federationApi.setPeerEnabled(peer.id, enabled);
        });

    const remove = async () => {
        if (!removing) return;
        const peer = removing;
        await withPeer(peer, async () => {
            const { data: removed } = await federationApi.removePeer(peer.id);
            showSnackbar(t('federationRemovePeerDone', { name: peer.name, count: removed.removedItems }), 'success');
        });
        setRemoving(null);
    };

    if (isLoading) {
        return <CircularProgress size={24} />;
    }
    if (isError || !data) {
        return <Alert severity="error">{t('federationLoadError')}</Alert>;
    }

    const statusLabel: Record<FederationPeerStatus, string> = {
        pending: t('federationPeerStatusPending'),
        ok: t('federationPeerStatusOk'),
        error: t('federationPeerStatusError'),
        credential_rejected: t('federationPeerStatusCredentialRejected'),
        credential_missing: t('federationPeerStatusCredentialMissing'),
        identity_mismatch: t('federationPeerStatusIdentityMismatch'),
        incompatible: t('federationPeerStatusIncompatible'),
    };

    const formValid = form?.mode === 'replace' ? credential.trim() !== '' : name.trim() && baseUrl.trim() && credential.trim();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {t('federationPeersTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                {t('federationPeersDescription')}
            </Typography>
            <Box>
                <Button variant="outlined" startIcon={<AddIcon />} onClick={() => openForm({ mode: 'add' })}>
                    {t('federationAddPeer')}
                </Button>
            </Box>
            {data.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                    {t('federationNoPeers')}
                </Typography>
            )}
            {data.map((peer) => {
                const busy = busyPeer === peer.id;
                return (
                    <Box
                        key={peer.id}
                        sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 600 }}>
                                {peer.name}
                            </Typography>
                            {peer.enabled ? (
                                <Chip size="small" label={statusLabel[peer.status]} color={STATUS_COLORS[peer.status]} />
                            ) : (
                                <Chip size="small" label={t('federationPeerDisabled')} />
                            )}
                            {peer.lanException && <Chip size="small" variant="outlined" label={t('federationPeerLan')} />}
                            {peer.audience === 'owner' && (
                                <Chip size="small" variant="outlined" color="warning" label={t('federationVisibilityOwner')} />
                            )}
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                            {peer.baseUrl} ·{' '}
                            {peer.lastSuccessAt !== null
                                ? t('federationPeerLastSync', { time: new Date(peer.lastSuccessAt).toLocaleString() })
                                : t('federationPeerNeverSynced')}
                        </Typography>
                        {peer.lastError && peer.status !== 'ok' && (
                            <Alert severity={STATUS_COLORS[peer.status] === 'error' ? 'error' : 'warning'}>
                                {peer.lastError}
                            </Alert>
                        )}
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={peer.enabled}
                                        disabled={busy}
                                        onChange={(event) => void setEnabled(peer, event.target.checked)}
                                    />
                                }
                                label={t('federationPeerEnabled')}
                            />
                            <Button size="small" disabled={busy || !peer.enabled} onClick={() => void syncNow(peer)}>
                                {busy ? <CircularProgress size={16} /> : t('federationSyncNow')}
                            </Button>
                            <Button size="small" disabled={busy} onClick={() => openForm({ mode: 'replace', peer })}>
                                {t('federationReplaceCredential')}
                            </Button>
                            <Button size="small" color="error" disabled={busy} onClick={() => setRemoving(peer)}>
                                {t('remove')}
                            </Button>
                        </Box>
                    </Box>
                );
            })}

            <Dialog open={form !== null} onClose={() => !submitting && setForm(null)} fullWidth maxWidth="sm">
                <DialogHeader
                    title={form?.mode === 'replace' ? t('federationReplaceCredential') : t('federationAddPeer')}
                    onClose={() => setForm(null)}
                    closeDisabled={submitting}
                    closeLabel={t('close')}
                />
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                    {form?.mode === 'add' && (
                        <>
                            <TextField
                                label={t('name')}
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                slotProps={{ htmlInput: { maxLength: 100 } }}
                                fullWidth
                                sx={{ mt: 1 }}
                            />
                            <TextField
                                label={t('federationPeerUrl')}
                                value={baseUrl}
                                onChange={(event) => setBaseUrl(event.target.value)}
                                helperText={t('federationPeerUrlHint')}
                                fullWidth
                            />
                        </>
                    )}
                    <TextField
                        label={t('federationPeerCredential')}
                        value={credential}
                        onChange={(event) => setCredential(event.target.value)}
                        type="password"
                        autoComplete="off"
                        fullWidth
                        sx={form?.mode === 'replace' ? { mt: 1 } : undefined}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setForm(null)} disabled={submitting}>
                        {t('cancel')}
                    </Button>
                    <Button variant="contained" disabled={!formValid || submitting} onClick={() => void submitForm()}>
                        {submitting ? <CircularProgress size={18} /> : t('save')}
                    </Button>
                </DialogActions>
            </Dialog>

            {removing && (
                <ConfirmationModal
                    isOpen
                    onClose={() => setRemoving(null)}
                    onConfirm={remove}
                    title={t('remove')}
                    message={t('federationRemovePeerConfirm', { name: removing.name })}
                    confirmText={t('remove')}
                    cancelText={t('cancel')}
                    isDanger
                />
            )}
        </Box>
    );
};

export default FederationPeers;
