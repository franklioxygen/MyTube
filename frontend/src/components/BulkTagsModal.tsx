import { Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { normalizeBulkTags, validBulkTags } from '../utils/bulkVideoOrganization';

interface Props {
    count: number;
    availableTags: string[];
    pending: boolean;
    error: ReactNode;
    onClose: () => void;
    onSave: (tags: string[]) => Promise<void>;
}

export default function BulkTagsModal({ count, availableTags, pending, error, onClose, onSave }: Props) {
    const { t } = useLanguage();
    const [tags, setTags] = useState<string[]>([]);
    const [input, setInput] = useState('');
    const requested = normalizeBulkTags([...tags, input]);
    const valid = validBulkTags(requested);
    return (
        <Dialog open onClose={() => !pending && onClose()} fullWidth maxWidth="sm">
            <DialogTitle>{t('bulkTagsTitle', { count })}</DialogTitle>
            <DialogContent dividers>
                <Alert severity="info" sx={{ mb: 2 }}>{t('bulkTagsHint')}</Alert>
                {error}
                <Autocomplete multiple freeSolo options={availableTags} value={tags} inputValue={input}
                    disabled={pending} onChange={(_, next) => setTags(normalizeBulkTags(next))}
                    onInputChange={(_, value) => setInput(value)}
                    renderInput={(params) => <TextField {...params} label={t('tags')}
                        error={requested.length > 0 && !valid} helperText={t('bulkTagsValidation')} />}
                />
            </DialogContent>
            <DialogActions>
                <Button disabled={pending} onClick={onClose}>{t('cancel')}</Button>
                <Button variant="contained" disabled={!valid || count === 0} loading={pending}
                    onClick={() => { void onSave(requested).catch(() => { /* Error is displayed by the owner. */ }); }}>
                    {t('addTags')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
