import { Add } from '@mui/icons-material';
import {
    Alert,
    Autocomplete,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    TextField,
    Typography
} from '@mui/material';
import type { FilterOptionsState } from '@mui/material/useAutocomplete';
import React, { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Collection } from '../types';

interface CollectionModalProps {
    open: boolean;
    onClose: () => void;
    videoCollections?: Collection[];
    collections?: Collection[];
    onAddToCollection?: (collectionId: string) => Promise<void>;
    onCreateCollection?: (name: string) => Promise<void>;
    onRemoveFromCollection?: (collectionId: string) => void | Promise<void>;
}

type PendingAction = 'add' | 'create' | `remove:${string}` | null;
type CollectionOption = Collection | string;

const CollectionModal: React.FC<CollectionModalProps> = ({
    open,
    onClose,
    videoCollections,
    collections,
    onAddToCollection,
    onCreateCollection,
    onRemoveFromCollection
}) => {
    const { t } = useLanguage();
    const [textInput, setTextInput] = useState<string>('');
    const [selectedOption, setSelectedOption] = useState<CollectionOption | null>(null);
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);
    const nativeAutocompleteToken = useMemo(
        () => `collection-lookup-${Math.random().toString(36).slice(2)}`,
        []
    );

    const isCurrentCollection = useCallback(
        (collectionId: string) =>
            videoCollections?.some((vc) => vc.id === collectionId) ?? false,
        [videoCollections]
    );

    const collectionOptions = useMemo(
        () =>
            [...(collections ?? [])].sort((a, b) =>
                a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            ),
        [collections]
    );

    const trimmedInput = textInput.trim();

    const matchedExisting = trimmedInput
        ? collectionOptions.find(
              (c) => c.name.trim().toLowerCase() === trimmedInput.toLowerCase()
          )
        : undefined;

    const hasExactMatch = Boolean(matchedExisting);

    const filterCollectionOptions = useCallback(
        (options: CollectionOption[], { inputValue }: FilterOptionsState<CollectionOption>): CollectionOption[] => {
            const collectionsOnly = options.filter((o): o is Collection => typeof o !== 'string');
            const q = inputValue.trim().toLowerCase();
            if (!q) return collectionsOnly;

            const filtered = collectionsOnly.filter((c) => c.name.toLowerCase().includes(q));

            if (!onCreateCollection) return filtered;

            const isExisting = collectionsOnly.some((c) => c.name.trim().toLowerCase() === q);
            if (inputValue.trim() !== '' && !isExisting) {
                return [inputValue.trim(), ...filtered];
            }
            return filtered;
        },
        [onCreateCollection]
    );

    const resolvedCollection = trimmedInput
        ? collectionOptions.find(
              (c) => c.name.trim().toLowerCase() === trimmedInput.toLowerCase()
          )
        : undefined;

    const canSubmit = Boolean(
        trimmedInput &&
            (!resolvedCollection || !isCurrentCollection(resolvedCollection.id)) &&
            (resolvedCollection ? onAddToCollection : onCreateCollection)
    );

    const submitLabel = hasExactMatch
        ? (matchedExisting && isCurrentCollection(matchedExisting.id) ? t('current') : t('add'))
        : (onCreateCollection ? t('create') : t('add'));

    const showUnifiedInput =
        Boolean(onAddToCollection || onCreateCollection) &&
        !(onAddToCollection && !onCreateCollection && collectionOptions.length === 0);

    const resetInputs = () => {
        setTextInput('');
        setSelectedOption(null);
    };

    const resetAndClose = () => {
        resetInputs();
        onClose();
    };

    const handleClose = () => {
        if (pendingAction) return;
        resetInputs();
        onClose();
    };

    const submit = async () => {
        if (pendingAction) return;

        const name = trimmedInput;
        if (!name) return;

        if (resolvedCollection) {
            if (isCurrentCollection(resolvedCollection.id) || !onAddToCollection) return;
            setPendingAction('add');
            try {
                await onAddToCollection(resolvedCollection.id);
                resetAndClose();
            } catch {
                // Keep the modal open so the action can be retried.
            } finally {
                setPendingAction(null);
            }
        } else {
            if (!onCreateCollection) return;
            setPendingAction('create');
            try {
                await onCreateCollection(name);
                resetAndClose();
            } catch {
                // Keep the modal open so the action can be retried.
            } finally {
                setPendingAction(null);
            }
        }
    };

    const handleRemove = async (collectionId: string) => {
        if (!onRemoveFromCollection) return;
        setPendingAction(`remove:${collectionId}`);
        try {
            await onRemoveFromCollection(collectionId);
            resetAndClose();
        } catch {
            // Keep the modal open so the action can be retried.
        } finally {
            setPendingAction(null);
        }
    };

    const renderCollectionOption = (
        props: React.HTMLAttributes<HTMLLIElement> & { key: string },
        option: CollectionOption
    ) => {
        const { key, ...otherProps } = props;
        const isStr = typeof option === 'string';
        const coll = isStr ? null : option;
        const current = coll ? isCurrentCollection(coll.id) : false;

        return (
            <li key={key} {...otherProps}>
                {isStr ? (
                    <span>
                        <Add fontSize="small" sx={{ mr: 1, verticalAlign: 'middle' }} />
                        {t('createNewCollectionLabel', { name: option })}
                    </span>
                ) : (
                    <span>
                        {coll!.name}
                        {current ? (
                            <>
                                {' '}
                                <Typography component="span" variant="caption">
                                    ({t('current')})
                                </Typography>
                            </>
                        ) : null}
                    </span>
                )}
            </li>
        );
    };

    return (
        <Dialog
            open={open}
            onClose={() => {
                if (!pendingAction) handleClose();
            }}
            disableEscapeKeyDown={Boolean(pendingAction)}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>{t('addToCollection')}</DialogTitle>
            <DialogContent dividers>
                {videoCollections && videoCollections.length > 0 && onRemoveFromCollection && (
                    <Stack spacing={1.5} sx={{ mb: 3 }}>
                        {videoCollections.map((collection) => (
                            <Alert
                                key={collection.id}
                                severity="info"
                                action={
                                    <Button
                                        color="error"
                                        size="small"
                                        onClick={() => { void handleRemove(collection.id); }}
                                        disabled={Boolean(pendingAction)}
                                        loading={pendingAction === `remove:${collection.id}`}
                                        loadingPosition="start"
                                    >
                                        {t('remove')}
                                    </Button>
                                }
                            >
                                {t('currentlyIn')} <strong>{collection.name}</strong>
                                <Typography variant="caption" display="block">
                                    {t('collectionWarning')}
                                </Typography>
                            </Alert>
                        ))}
                    </Stack>
                )}

                {showUnifiedInput && (
                    <Box>
                        <Stack direction="row" spacing={2}>
                            <Autocomplete<CollectionOption, false, false, true>
                                freeSolo
                                fullWidth
                                size="small"
                                options={collectionOptions}
                                getOptionLabel={(option) =>
                                    typeof option === 'string' ? option : option.name
                                }
                                isOptionEqualToValue={(opt, val) =>
                                    typeof opt === 'string' || typeof val === 'string'
                                        ? opt === val
                                        : opt.id === val.id
                                }
                                value={selectedOption}
                                inputValue={textInput}
                                onInputChange={(_, text, reason) => {
                                    if (reason !== 'reset') setTextInput(text);
                                }}
                                onChange={(_, newValue) => {
                                    setSelectedOption(newValue);
                                    setTextInput(
                                        typeof newValue === 'string'
                                            ? newValue
                                            : newValue?.name ?? ''
                                    );
                                }}
                                filterOptions={filterCollectionOptions}
                                getOptionDisabled={(option) =>
                                    typeof option !== 'string' && isCurrentCollection(option.id)
                                }
                                renderOption={renderCollectionOption}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label={t('selectOrCreateCollection')}
                                        placeholder={t('selectOrCreateCollection')}
                                        autoComplete="off"
                                        slotProps={{
                                            htmlInput: {
                                                ...params.inputProps,
                                                autoCapitalize: 'none',
                                                autoComplete: nativeAutocompleteToken,
                                                autoCorrect: 'off',
                                                id: nativeAutocompleteToken,
                                                name: nativeAutocompleteToken,
                                                spellCheck: false,
                                                type: 'search',
                                            },
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                void submit();
                                            }
                                        }}
                                    />
                                )}
                                disabled={Boolean(pendingAction)}
                                slotProps={{ listbox: { sx: { maxHeight: 280, overflow: 'auto' } } }}
                            />
                            <Button
                                variant="contained"
                                onClick={() => { void submit(); }}
                                disabled={!canSubmit || Boolean(pendingAction)}
                                loading={pendingAction === 'create' || pendingAction === 'add'}
                                loadingPosition="start"
                            >
                                {submitLabel}
                            </Button>
                        </Stack>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} color="inherit" disabled={Boolean(pendingAction)}>
                    {t('cancel')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default CollectionModal;
