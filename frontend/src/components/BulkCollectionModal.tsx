import { Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, TextField } from '@mui/material';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import type { Collection } from '../types';
import { createCollectionId, hasControlCharacters } from '../utils/bulkVideoOrganization';

type Target = { collectionId: string } | { newCollection: { id: string; name: string } };
interface Props {
    count: number;
    collections: Collection[];
    pending: boolean;
    error: ReactNode;
    onClose: () => void;
    onSave: (target: Target) => Promise<void>;
}

export default function BulkCollectionModal({ count, collections, pending, error, onClose, onSave }: Props) {
    const { t } = useLanguage();
    const [mode, setMode] = useState('existing');
    const [selected, setSelected] = useState<Collection | null>(null);
    const [name, setName] = useState('');
    const candidate = useRef<{ id: string; name: string } | null>(null);
    const trimmed = name.trim();
    const validName = trimmed.length > 0 && Array.from(trimmed).length <= 200 &&
        !hasControlCharacters(trimmed) && !/[<>:"/\\|?*]/u.test(trimmed) && !trimmed.endsWith('.');
    const save = async () => {
        if (mode === 'existing' && selected) await onSave({ collectionId: selected.id });
        else if (mode === 'new' && validName) {
            if (candidate.current?.name !== trimmed) candidate.current = { name: trimmed, id: createCollectionId() };
            await onSave({ newCollection: candidate.current });
        }
    };
    return (
        <Dialog open onClose={() => !pending && onClose()} fullWidth maxWidth="sm">
            <DialogTitle>{t('bulkCollectionTitle', { count })}</DialogTitle>
            <DialogContent dividers>
                <Alert severity="info" sx={{ mb: 2 }}>{t('bulkCollectionHint')}</Alert>
                {error}
                <RadioGroup row value={mode} onChange={(_, value) => setMode(value)}>
                    <FormControlLabel value="existing" disabled={pending} control={<Radio />} label={t('bulkExistingCollection')} />
                    <FormControlLabel value="new" disabled={pending} control={<Radio />} label={t('bulkNewCollection')} />
                </RadioGroup>
                {mode === 'existing' ? <Autocomplete options={collections} value={selected}
                    disabled={pending} getOptionLabel={(option) => option.name}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    onChange={(_, value) => setSelected(value)}
                    renderInput={(params) => <TextField {...params} label={t('collections')} />}
                /> : <TextField fullWidth value={name} disabled={pending} label={t('bulkNewCollection')}
                    onChange={(event) => setName(event.target.value)} error={name.length > 0 && !validName}
                    helperText={t('bulkCollectionNameHint')} />}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={pending}>{t('cancel')}</Button>
                <Button variant="contained" loading={pending}
                    disabled={count === 0 || (mode === 'existing' ? !selected : !validName)}
                    onClick={() => { void save().catch(() => { /* Error is displayed by the owner. */ }); }}>
                    {t('bulkAddToCollection')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
