import { Add, ChatBubbleOutline, Close, DeleteOutline, FileUploadOutlined, InfoOutlined, Refresh, Remove } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Divider, Drawer, IconButton, InputBase, Popover, Slider, Stack, Switch, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type MouseEvent, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { api } from '../../utils/apiClient';
import { danmakuPanelPlacement, type DanmakuEvent, type DanmakuTrack } from '../../utils/danmaku';
import { cancelAutomotiveZoom } from '../../utils/viewportUnits';
import DanmakuOverlay from './DanmakuOverlay';

const EMPTY_EVENTS: DanmakuEvent[] = [];
const OFFSET_LIMIT = 3600;
const OFFSET_STEP = 0.5;
const MIN_OPACITY = 0.2;
const DEFAULT_OPACITY = 0.8;
const clampOffset = (value: number) => Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, Math.round(value * 10) / 10));

/** Steppers cover what a phone's numeric keypad cannot type (a minus sign); the field stays for large jumps. */
function OffsetStepper({ value, label, disabled, touch, onChange }: {
    value: number; label: string; disabled: boolean; touch: boolean; onChange: (value: number) => void;
}) {
    // Held as text so a half-typed "-" survives until it parses.
    const [draft, setDraft] = useState<string | null>(null);
    const step = (delta: number) => { setDraft(null); onChange(clampOffset(value + delta)); };
    const buttonSx = { borderRadius: 0, width: touch ? 44 : 32, height: touch ? 44 : 32 };
    return <Box sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <IconButton size="small" aria-label={`${label} -${OFFSET_STEP}`} disabled={disabled || value <= -OFFSET_LIMIT} onClick={() => step(-OFFSET_STEP)} sx={buttonSx}>
            <Remove fontSize="small" />
        </IconButton>
        <InputBase type="number" value={draft ?? String(value)} disabled={disabled} onBlur={() => setDraft(null)}
            onChange={event => {
                setDraft(event.target.value);
                if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) onChange(clampOffset(Number(event.target.value)));
            }}
            slotProps={{ input: { 'aria-label': label, min: -OFFSET_LIMIT, max: OFFSET_LIMIT, step: OFFSET_STEP } }}
            sx={{ width: 56, fontSize: '0.875rem', '& input': { p: 0, textAlign: 'center', fontVariantNumeric: 'tabular-nums', MozAppearance: 'textfield',
                '&::-webkit-inner-spin-button, &::-webkit-outer-spin-button': { WebkitAppearance: 'none', m: 0 } } }} />
        <IconButton size="small" aria-label={`${label} +${OFFSET_STEP}`} disabled={disabled || value >= OFFSET_LIMIT} onClick={() => step(OFFSET_STEP)} sx={buttonSx}>
            <Add fontSize="small" />
        </IconButton>
    </Box>;
}

/** Viewing preferences stay local; upload/refresh/delete use the existing administrative policy. */
export default function DanmakuPlayer({ videoId, getTime, overlayContainer, canRefresh, fullscreenKeepsZoom = false }: {
    videoId: string; getTime: () => number; overlayContainer: HTMLElement | null; canRefresh: boolean; fullscreenKeepsZoom?: boolean;
}) {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const client = useQueryClient();
    const theme = useTheme();
    const isNarrow = useMediaQuery(theme.breakpoints.down('sm'));
    const isShort = useMediaQuery('(max-height: 500px)');
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    // Phones get a sheet that leaves the picture visible: below it in portrait, beside it in
    // landscape, where there is no height to spare. Everything else anchors to the button.
    const sheet = isShort && (isNarrow || isTouch) ? 'right' : isNarrow ? 'bottom' : null;
    const [enabled, setEnabled] = useState(() => localStorage.getItem('danmakuEnabled') === 'true');
    // The control bar re-parents this component across the mobile breakpoint, so rotating a phone
    // remounts it. Opacity is a general preference; an offset only syncs this one video's track.
    const offsetKey = `danmakuOffset:${videoId}`;
    const [opacity, setOpacity] = useState(() => {
        const stored = Number(localStorage.getItem('danmakuOpacity'));
        return stored >= MIN_OPACITY && stored <= 1 ? stored : DEFAULT_OPACITY;
    });
    const [offset, setOffset] = useState(() => clampOffset(Number(sessionStorage.getItem(offsetKey)) || 0));
    const changeOpacity = (value: number) => { setOpacity(value); localStorage.setItem('danmakuOpacity', String(value)); };
    const changeOffset = (value: number) => { setOffset(value); sessionStorage.setItem(offsetKey, String(value)); };
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [placement, setPlacement] = useState({ opensUp: false, maxHeight: 0 });
    const [message, setMessage] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);
    const titleId = useId();
    const endpoint = `/videos/${encodeURIComponent(videoId)}/danmaku`;
    const key = ['danmaku', videoId];
    const track = useQuery({ queryKey: key, queryFn: async () => (await api.get<DanmakuTrack>(endpoint)).data,
        retry: false, refetchOnWindowFocus: false, staleTime: 30_000,
        refetchInterval: query => query.state.data?.loading ? 1000 : false });
    const timeline = useQuery({ queryKey: [...key, 'events', track.data?.revision],
        queryFn: async () => (await api.get<{ events: DanmakuEvent[] }>(`${endpoint}/events`)).data.events,
        enabled: enabled && !!track.data?.revision, retry: false, staleTime: Infinity, gcTime: 60_000 });
    const mutation = useMutation({
        mutationFn: async ({ action, file }: { action: 'import' | 'load' | 'refresh' | 'delete'; file?: File }) => {
            if (action === 'delete') return api.delete(endpoint);
            if (action === 'load' || action === 'refresh') return api.post(`${endpoint}/refresh`, undefined, { timeout: 40_000 });
            const form = new FormData();
            form.append('danmaku', file!);
            return api.post(endpoint, form, { headers: { 'Content-Type': 'multipart/form-data' } });
        },
        onSuccess: async (response, variables) => {
            setMessage('');
            if (variables.action === 'load' && response.data.status === 'ready') {
                setEnabled(true);
                localStorage.setItem('danmakuEnabled', 'true');
            }
            client.setQueryData(key, response.data);
            await client.invalidateQueries({ queryKey: key });
        },
        onError: async () => { setMessage(t('danmakuOperationFailed')); await client.invalidateQueries({ queryKey: key }); },
    });
    const loading = track.isLoading || timeline.isFetching || mutation.isPending || track.data?.loading;
    const status = track.isError || timeline.isError ? 'danmakuLoadFailed' : loading ? 'danmakuLoading'
        : track.data?.status === 'ready' ? 'danmakuReady' : track.data?.status === 'empty' ? 'danmakuEmpty'
        : track.data?.status === 'error' ? 'danmakuLoadFailed' : 'danmakuNone';
    const statusColor = status === 'danmakuReady' ? 'success.main' : status === 'danmakuLoadFailed' ? 'error.main' : 'text.disabled';
    const openPanel = (event: MouseEvent<HTMLElement>) => {
        const { top, bottom } = event.currentTarget.getBoundingClientRect();
        setPlacement(danmakuPanelPlacement(top, bottom, window.innerHeight));
        setAnchor(event.currentTarget);
    };
    const closePanel = () => setAnchor(null);
    const actionSx = { justifyContent: 'flex-start', textAlign: 'start', minHeight: isTouch ? 44 : 36, px: 1.25, fontSize: '0.8125rem', fontWeight: 400 };
    const panel = <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, pl: 2, pr: 1, py: 1.25 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography id={titleId} component="h2" variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.4 }}>{t('danmaku')}</Typography>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                    {loading ? <CircularProgress size={10} color="inherit" sx={{ flexShrink: 0 }} />
                        : <Box sx={{ width: 6, height: 6, flexShrink: 0, borderRadius: '50%', bgcolor: statusColor }} />}
                    <Typography variant="caption" role="status">{t(status)}{track.data?.status === 'ready' ? ` (${track.data.eventCount})` : ''}</Typography>
                </Stack>
                {!!track.data?.ignoredCount && <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{t('danmakuIgnored')}: {track.data.ignoredCount}</Typography>}
            </Box>
            {/* Supplying input props replaces MUI's default role, so it has to be restated. */}
            <Switch checked={enabled} slotProps={{ input: { role: 'switch', 'aria-label': t('danmaku') } }} onChange={event => {
                setEnabled(event.target.checked); localStorage.setItem('danmakuEnabled', String(event.target.checked));
            }} />
            {sheet && <IconButton aria-label={t('close')} onClick={closePanel} sx={{ width: 44, height: 44 }}><Close /></IconButton>}
        </Box>
        <Box sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            <Stack spacing={1} sx={{ px: 2, '&:not(:empty)': { pb: 1.5 } }}>
                {userRole !== 'visitor' && canRefresh && track.isSuccess && !track.data.revision && <Button variant="contained"
                    disabled={!!loading} onClick={() => mutation.mutate({ action: 'load' })}>{t('danmakuLoad')}</Button>}
                {(track.isError || timeline.isError) && <Button variant="outlined" onClick={() => {
                    void track.refetch();
                    if (enabled && track.data?.revision) void timeline.refetch();
                }}>{t('retry')}</Button>}
                {(message || track.data?.lastError) && <Alert severity="warning" sx={{ py: 0 }}>{message || t('danmakuOperationFailed')}</Alert>}
            </Stack>
            {/* Display controls only have something to act on once a track has comments. */}
            {track.data?.status === 'ready' && <>
                <Divider />
                <Stack spacing={1.5} sx={{ px: 2, py: 1.5 }}>
                    <Box sx={{ color: enabled ? 'text.primary' : 'text.disabled' }}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <Typography variant="body2">{t('danmakuOpacity')}</Typography>
                            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(opacity * 100)}%</Typography>
                        </Stack>
                        <Slider aria-label={t('danmakuOpacity')} size={isTouch ? 'medium' : 'small'} disabled={!enabled} min={MIN_OPACITY} max={1} step={0.1} value={opacity}
                            getAriaValueText={value => `${Math.round(value * 100)}%`} onChange={(_, value) => changeOpacity(value as number)} sx={{ display: 'block' }} />
                    </Box>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: enabled ? 'text.primary' : 'text.disabled' }}>
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{t('danmakuOffset')}</Typography>
                        <OffsetStepper value={offset} label={t('danmakuOffset')} disabled={!enabled} touch={isTouch} onChange={changeOffset} />
                    </Stack>
                    <Stack direction="row" spacing={0.75} sx={{ color: 'text.secondary' }}>
                        <InfoOutlined sx={{ fontSize: 14, flexShrink: 0, mt: '2px' }} />
                        <Typography variant="caption" sx={{ lineHeight: 1.4 }}>{t('danmakuExternalNotice')}</Typography>
                    </Stack>
                </Stack>
            </>}
            {userRole !== 'visitor' && <>
                <Divider />
                <Stack sx={{ p: 0.75 }}>
                    <input ref={fileRef} type="file" accept=".xml" hidden aria-label={t('danmakuImport')} onChange={event => {
                        const file = event.target.files?.[0]; event.target.value = '';
                        if (!file) return;
                        if (file.size > 8 * 1024 * 1024) { setMessage(t('danmakuInvalidFile')); return; }
                        if (track.data?.revision && !window.confirm(t('danmakuReplaceConfirm'))) return;
                        mutation.mutate({ action: 'import', file });
                    }} />
                    <Button color="inherit" startIcon={<FileUploadOutlined />} disabled={mutation.isPending} sx={actionSx}
                        onClick={() => fileRef.current?.click()}>{t('danmakuImport')}</Button>
                    {canRefresh && !!track.data?.revision && <Button color="inherit" startIcon={<Refresh />} disabled={mutation.isPending} sx={actionSx} onClick={() => {
                        if (track.data?.revision && !window.confirm(t('danmakuReplaceConfirm'))) return;
                        mutation.mutate({ action: 'refresh' });
                    }}>{t('danmakuRefresh')}</Button>}
                    {!!track.data?.revision && <Button color="error" startIcon={<DeleteOutline />} disabled={mutation.isPending} sx={actionSx} onClick={() => {
                        if (window.confirm(t('danmakuDeleteConfirm'))) mutation.mutate({ action: 'delete' });
                    }}>{t('danmakuDelete')}</Button>}
                </Stack>
            </>}
        </Box>
    </Box>;
    const surfaceProps = {
        open: !!anchor,
        onClose: closePanel,
        container: document.fullscreenElement ?? undefined,
        sx: fullscreenKeepsZoom && document.fullscreenElement ? { zoom: cancelAutomotiveZoom } : undefined,
    };
    // Announcing a modal dialog is also what hands the keyboard to the panel instead of the player's shortcuts.
    const paperProps = { role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId };
    const paperSx = { display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundImage: 'none' };
    return <>
        {enabled && !timeline.isError && timeline.data && overlayContainer && createPortal(
            <DanmakuOverlay events={timeline.data ?? EMPTY_EVENTS} getTime={getTime} opacity={opacity} offset={offset} />, overlayContainer)}
        <Tooltip title={t('danmaku')} disableHoverListener={isTouch}><IconButton aria-label={t('danmaku')} aria-expanded={!!anchor} aria-haspopup="dialog"
            size="small" color={enabled ? 'primary' : 'inherit'} onClick={openPanel} sx={{ p: '8px' }}>
            <ChatBubbleOutline fontSize="small" />
        </IconButton></Tooltip>
        {sheet ? <Drawer {...surfaceProps} anchor={sheet} slotProps={{
            // No scrim: the point of adjusting danmaku is watching the picture change.
            backdrop: { invisible: true },
            paper: { ...paperProps, sx: { ...paperSx, ...(sheet === 'bottom'
                ? { maxHeight: '75vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 }
                : { width: 340, maxWidth: '85vw', borderTopLeftRadius: 16, borderBottomLeftRadius: 16 }) } },
        }}>{panel}</Drawer> : <Popover {...surfaceProps} anchorEl={anchor}
            anchorOrigin={{ vertical: placement.opensUp ? 'top' : 'bottom', horizontal: 'center' }}
            transformOrigin={{ vertical: placement.opensUp ? 'bottom' : 'top', horizontal: 'center' }}
            slotProps={{ paper: { ...paperProps, sx: { ...paperSx, width: 340, maxWidth: 'calc(100vw - 32px)', maxHeight: `min(calc(100% - 32px), ${placement.maxHeight}px)`,
                mt: placement.opensUp ? -1 : 1, border: 1, borderColor: 'divider', borderRadius: 3 } } }}>{panel}</Popover>}
    </>;
}
