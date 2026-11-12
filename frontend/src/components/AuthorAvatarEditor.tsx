import { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Slider, Stack, TextField, MenuItem, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useAuthorProfile } from '../hooks/useAuthorProfile';
import { useCloudStorageUrl } from '../hooks/useCloudStorageUrl';
import { Crop, INITIAL_CROP, cropRectangle, exportAvatar, validateAvatarImage } from '../utils/avatarCrop';

interface Props { author: string; onClose: () => void }
interface SelectedImage { image: HTMLImageElement; url: string }

function CropPreview({ selected, crop, size }: { selected: SelectedImage; crop: Crop; size: number }) {
    const { side, sx, sy } = cropRectangle(selected.image.naturalWidth, selected.image.naturalHeight, crop);
    return <Box sx={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', position: 'relative', bgcolor: '#fff', pointerEvents: 'none', flexShrink: 0 }}>
        <Box component="img" src={selected.url} alt="" draggable={false} sx={{ position: 'absolute', maxWidth: 'none',
            width: selected.image.naturalWidth / side * size, height: selected.image.naturalHeight / side * size,
            left: -sx / side * size, top: -sy / side * size }} />
    </Box>;
}

/** Mounted only while open; a new author always receives a fresh draft. */
export default function AuthorAvatarEditor({ author, onClose }: Props) {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const profile = useAuthorProfile(author);
    const [selected, setSelected] = useState<SelectedImage | null>(null);
    const [crop, setCrop] = useState<Crop>(INITIAL_CROP);
    const [restore, setRestore] = useState(false);
    const [busy, setBusy] = useState(false);
    const [reading, setReading] = useState(false);
    const [error, setError] = useState('');
    const [fetching, setFetching] = useState(false);
    const [sourceChannel, setSourceChannel] = useState('');
    const [sourcePreview, setSourcePreview] = useState(false);
    const locked = busy || fetching;
    const sources = profile.data?.avatarSources ?? [];
    const generation = useRef(0);
    const fetchController = useRef<AbortController | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const pointer = useRef<{ x: number; y: number; crop: Crop } | null>(null);
    const theme = useTheme();
    const mobile = useMediaQuery(theme.breakpoints.down('sm'));
    const size = mobile ? 220 : 260;
    const preview = useCloudStorageUrl(restore ? profile.data?.defaultAvatarPath : profile.data?.effectiveAvatarPath, 'thumbnail');
    useEffect(() => () => { generation.current++; fetchController.current?.abort(); }, []);
    useEffect(() => () => { if (selected) URL.revokeObjectURL(selected.url); }, [selected]);
    const choose = async (file?: File) => {
        if (!file || busy) return;
        const token = ++generation.current;
        setReading(true); setError('');
        let url: string | undefined;
        try {
            await validateAvatarImage(file);
            url = URL.createObjectURL(file);
            const image = new Image(); image.src = url;
            await image.decode();
            if (generation.current !== token) { URL.revokeObjectURL(url); return; }
            setSelected({ image, url }); setCrop(INITIAL_CROP); setRestore(false); setSourcePreview(false);
            return true;
        } catch (err) {
            if (url) URL.revokeObjectURL(url);
            if (generation.current === token) setError(t(err instanceof Error && err.message === 'dimensions' ? 'authorAvatarDimensionsError' : 'authorAvatarFormatError'));
        } finally { if (generation.current === token) setReading(false); }
    };
    const fetchFromSource = async () => {
        const channelUrl = sources.length === 1 ? sources[0].channelUrl : sourceChannel;
        if (!channelUrl) return;
        const controller = new AbortController();
        fetchController.current = controller;
        setFetching(true); setError('');
        try {
            const file = await profile.fetchFromSource(channelUrl, controller.signal);
            if (controller.signal.aborted) return;
            if (await choose(file)) setSourcePreview(true);
        } catch { if (!controller.signal.aborted) setError(t('authorAvatarSourceError')); }
        finally { setFetching(false); }
    };
    const save = async () => {
        setBusy(true); setError('');
        try {
            await profile.save(restore ? null : await exportAvatar(selected!.image, crop));
            showSnackbar(t('authorAvatarSaved'), 'success'); onClose();
        } catch {
            setError(t('authorAvatarSaveError'));
            // A timed-out request may have committed; show the actual persisted state.
            await profile.refetch();
        } finally { setBusy(false); }
    };
    const close = () => {
        if (busy) return;
        fetchController.current?.abort();
        onClose();
    };
    const clamp = (n: number) => Math.max(-1, Math.min(1, n));
    return <Dialog open onClose={busy ? undefined : close} fullWidth fullScreen={mobile} maxWidth="sm" aria-labelledby="author-avatar-title">
        <DialogTitle id="author-avatar-title">{t('authorAvatarTitle')}</DialogTitle>
        <DialogContent>
            <Stack spacing={2} alignItems="center" sx={{ mt: 1 }}>
                <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{author}</Typography>
                {profile.isPending ? <CircularProgress /> : profile.isError ? <Alert severity="error" action={<Button onClick={() => void profile.refetch()}>{t('retry')}</Button>}>{t('authorAvatarLoadError')}</Alert> : <>
                    <Typography variant="body2" color="text.secondary">{t('authorAvatarScope', { author, count: profile.data?.videoCount ?? 0 })}</Typography>
                    {profile.data?.multipleSources && <Alert severity="info">{t('authorAvatarMultipleSources')}</Alert>}
                    {selected && !restore ? <>
                        <Box role="group" tabIndex={locked ? -1 : 0} aria-label={t('authorAvatarMove')} onKeyDown={event => {
                            const movements: Record<string, [number, number]> = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] };
                            const move = movements[event.key];
                            if (!move || locked) return;
                            event.preventDefault(); setCrop(c => ({ ...c, x: clamp(c.x + move[0]), y: clamp(c.y + move[1]) }));
                        }} onPointerDown={event => {
                            if (locked) return;
                            event.currentTarget.setPointerCapture(event.pointerId);
                            pointer.current = { x: event.clientX, y: event.clientY, crop };
                        }} onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }} onPointerMove={event => {
                            const start = pointer.current;
                            if (!start || locked) return;
                            const { side } = cropRectangle(selected.image.naturalWidth, selected.image.naturalHeight, start.crop);
                            const dx = (selected.image.naturalWidth - side) * size / side;
                            const dy = (selected.image.naturalHeight - side) * size / side;
                            setCrop({ ...start.crop, x: dx ? clamp(start.crop.x - 2 * (event.clientX - start.x) / dx) : 0,
                                y: dy ? clamp(start.crop.y - 2 * (event.clientY - start.y) / dy) : 0 });
                        }} sx={{ borderRadius: '50%', touchAction: 'none', cursor: 'move', '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 4 } }}>
                            <CropPreview selected={selected} crop={crop} size={size} />
                        </Box>
                        <CropPreview selected={selected} crop={crop} size={48} />
                        <Typography variant="caption">{t('authorAvatarMove')}</Typography>
                        <Box sx={{ width: '90%' }}><Typography id="avatar-zoom-label">{t('authorAvatarZoom')}</Typography>
                            <Slider min={1} max={4} step={0.05} value={crop.zoom} disabled={locked} aria-labelledby="avatar-zoom-label" onChange={(_, zoom) => setCrop(c => ({ ...c, zoom: zoom as number }))} /></Box>
                        <Button onClick={() => setCrop(INITIAL_CROP)} disabled={locked}>{t('authorAvatarCenter')}</Button>
                        {Math.min(selected.image.naturalWidth, selected.image.naturalHeight) < 128 && <Alert severity="warning">{t('authorAvatarSmall')}</Alert>}
                    </> : <Avatar src={preview} sx={{ width: size, height: size, fontSize: 64 }}>{author.charAt(0)}</Avatar>}
                    <Typography variant="body2" color="text.secondary">{restore ? t('authorAvatarRestoring') : selected ? t('authorAvatarPending') : t(profile.data?.avatarOrigin === 'custom' ? 'authorAvatarCustom' : profile.data?.avatarOrigin === 'auto' ? 'authorAvatarAuto' : 'authorAvatarNone')}</Typography>
                    {sourcePreview && <Alert severity="info">{t('authorAvatarSourcePreview')}</Alert>}
                    {sources.length > 1 && <TextField select fullWidth label={t('authorAvatarSourceChannel')}
                        value={sourceChannel} disabled={locked || reading} onChange={event => setSourceChannel(event.target.value)}>
                        {sources.map(source => <MenuItem key={source.channelUrl} value={source.channelUrl}>{source.channelUrl}</MenuItem>)}
                    </TextField>}
                    {sources.length > 0 ? <>
                        <Button variant="outlined" loading={fetching} disabled={busy || reading || (sources.length > 1 && !sourceChannel)}
                            onClick={() => void fetchFromSource()}>{t('authorAvatarSourceFetch')}</Button>
                        <Typography variant="caption" color="text.secondary">{t('authorAvatarSourceHint')}</Typography>
                    </> : <Typography variant="caption" color="text.secondary">{t('authorAvatarSourceUnavailable')}</Typography>}
                    <Button variant="outlined" disabled={locked || reading} onClick={() => input.current?.click()}>{t('selectImage')}</Button>
                    <Typography variant="caption" color="text.secondary">{t('authorAvatarFormatHint')}</Typography>
                    {reading && <CircularProgress size={24} />}
                    {profile.data?.customAvatarPath && <Button disabled={locked || reading} onClick={() => { setRestore(true); setSelected(null); setSourcePreview(false); setError(''); }}>{t('authorAvatarRestore')}</Button>}
                </>}
                <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
                {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}
            </Stack>
        </DialogContent>
        <DialogActions>
            <Button onClick={close} disabled={busy}>{t('cancel')}</Button>
            <Button variant="contained" loading={busy} disabled={locked || reading || profile.isPending || profile.isError || (!selected && !restore)} onClick={() => void save()}>{t(restore ? 'save' : 'authorAvatarSave')}</Button>
        </DialogActions>
    </Dialog>;
}
