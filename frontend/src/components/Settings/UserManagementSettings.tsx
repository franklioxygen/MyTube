import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    FormControlLabel,
    IconButton,
    InputAdornment,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { VisitorUser } from '../../types';
import { getApiErrorMessage } from '../../utils/apiClient';
import { copyTextToClipboard } from '../../utils/clipboard';
import { runMutationAsync } from '../../utils/mutationUtils';
import { userApi } from '../../utils/userApi';
import AlertModal from '../AlertModal';
import ConfirmationModal from '../ConfirmationModal';
import DialogHeader from '../DialogHeader';

interface UserManagementSettingsProps {
    loginEnabled: boolean;
    visitorUserEnabled: boolean;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;
const GENERATED_CREDENTIAL_CHARSETS = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789._-',
];
const GENERATED_CREDENTIAL_ALPHABET = GENERATED_CREDENTIAL_CHARSETS.join('');

const GENERATED_PASSWORD_LENGTH = 16;

const generatePassword = (): string => {
    // Rejection sampling: discard bytes above the largest multiple of the
    // alphabet size so every character is equally likely.
    const maxUnbiasedByte = Math.floor(256 / GENERATED_CREDENTIAL_ALPHABET.length) * GENERATED_CREDENTIAL_ALPHABET.length;
    const chars: string[] = [];
    while (chars.length < GENERATED_PASSWORD_LENGTH) {
        const bytes = new Uint8Array(GENERATED_PASSWORD_LENGTH * 2);
        window.crypto.getRandomValues(bytes);
        for (const byte of bytes) {
            if (byte < maxUnbiasedByte && chars.length < GENERATED_PASSWORD_LENGTH) {
                chars.push(GENERATED_CREDENTIAL_ALPHABET[byte % GENERATED_CREDENTIAL_ALPHABET.length]);
            }
        }
    }
    return chars.join('');
};

const isUsernameValid = (value: string): boolean => {
    const trimmed = value.trim();
    return (
        trimmed.length >= USERNAME_MIN_LENGTH &&
        trimmed.length <= USERNAME_MAX_LENGTH &&
        USERNAME_PATTERN.test(trimmed)
    );
};

const isPasswordValid = (value: string): boolean =>
    value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;

const formatLastLogin = (value: number | null): string | null => {
    if (value === null) {
        return null;
    }

    return new Date(value).toLocaleString();
};

const UserManagementSettings: React.FC<UserManagementSettingsProps> = ({
    loginEnabled,
    visitorUserEnabled,
}) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const queryClient = useQueryClient();
    const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
    const [selectedUser, setSelectedUser] = useState<VisitorUser | null>(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [setNewPassword, setSetNewPassword] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [confirmDisableUser, setConfirmDisableUser] = useState<VisitorUser | null>(null);
    const [confirmDeleteUser, setConfirmDeleteUser] = useState<VisitorUser | null>(null);
    const [alertOpen, setAlertOpen] = useState(false);
    const [alertTitle, setAlertTitle] = useState('');
    const [alertMessage, setAlertMessage] = useState('');

    const queryEnabled = loginEnabled && visitorUserEnabled && userRole !== 'visitor';
    const {
        data: users = [],
        isLoading,
        isError,
    } = useQuery({
        queryKey: ['users'],
        queryFn: userApi.fetchUsers,
        enabled: queryEnabled,
    });

    const usernameError = username.length > 0 && !isUsernameValid(username);
    const passwordRequired = dialogMode === 'create' || setNewPassword;
    const passwordError = passwordRequired && password.length > 0 && !isPasswordValid(password);
    const hasChangedUsername =
        dialogMode === 'create' || username.trim() !== (selectedUser?.username ?? '');
    const canSubmit = useMemo(() => {
        if (!dialogMode) {
            return false;
        }
        if (!isUsernameValid(username)) {
            return false;
        }
        if (passwordRequired && !isPasswordValid(password)) {
            return false;
        }
        if (dialogMode === 'edit') {
            return hasChangedUsername || (setNewPassword && password.length > 0);
        }
        return true;
    }, [dialogMode, hasChangedUsername, password, passwordRequired, setNewPassword, username]);

    const showAlert = (title: string, message: string) => {
        setAlertTitle(title);
        setAlertMessage(message);
        setAlertOpen(true);
    };

    const showMutationError = async (error: unknown) => {
        const message = await getApiErrorMessage(error, t);
        showAlert(t('error'), message || t('unexpectedErrorOccurred'));
    };

    const invalidateUsers = () => {
        queryClient.invalidateQueries({ queryKey: ['users'] });
        queryClient.invalidateQueries({ queryKey: ['authSettings'] });
    };

    const createMutation = useMutation({
        mutationFn: userApi.createUser,
        onSuccess: () => {
            invalidateUsers();
            closeDialog();
            showAlert(t('success'), t('userCreated'));
        },
        onError: (error) => {
            void showMutationError(error);
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof userApi.updateUser>[1] }) =>
            userApi.updateUser(id, patch),
        onSuccess: () => {
            invalidateUsers();
            closeDialog();
            setConfirmDisableUser(null);
            showAlert(t('success'), t('userUpdated'));
        },
        onError: (error) => {
            void showMutationError(error);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: userApi.deleteUser,
        onSuccess: () => {
            invalidateUsers();
            setConfirmDeleteUser(null);
            showAlert(t('success'), t('userDeleted'));
        },
        onError: (error) => {
            void showMutationError(error);
        },
    });

    useEffect(() => {
        if (dialogMode === 'create') {
            setUsername('');
            setPassword('');
            setSetNewPassword(true);
            setShowPassword(false);
        }
        if (dialogMode === 'edit' && selectedUser) {
            setUsername(selectedUser.username);
            setPassword('');
            setSetNewPassword(false);
            setShowPassword(false);
        }
    }, [dialogMode, selectedUser]);

    const closeDialog = () => {
        setDialogMode(null);
        setSelectedUser(null);
        setUsername('');
        setPassword('');
        setSetNewPassword(false);
        setShowPassword(false);
    };

    const openCreateDialog = () => {
        setSelectedUser(null);
        setDialogMode('create');
    };

    const openEditDialog = (user: VisitorUser) => {
        setSelectedUser(user);
        setDialogMode('edit');
    };

    const handleGeneratePassword = () => {
        setPassword(generatePassword());
    };

    const handleCopyPassword = async () => {
        if (!password) {
            return;
        }

        try {
            const copied = await copyTextToClipboard(password);
            if (copied) {
                showAlert(t('success'), t('passwordCopied'));
            }
        } catch {
            showAlert(t('error'), t('apiKeyCopyFailed'));
        }
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit) {
            return;
        }

        const trimmedUsername = username.trim();
        if (dialogMode === 'create') {
            createMutation.mutate({ username: trimmedUsername, password });
            return;
        }

        if (!selectedUser) {
            return;
        }

        const patch: { username?: string; password?: string } = {};
        if (hasChangedUsername) {
            patch.username = trimmedUsername;
        }
        if (setNewPassword) {
            patch.password = password;
        }
        updateMutation.mutate({ id: selectedUser.id, patch });
    };

    const handleToggleEnabled = (user: VisitorUser, enabled: boolean) => {
        if (!enabled) {
            setConfirmDisableUser(user);
            return;
        }

        updateMutation.mutate({ id: user.id, patch: { enabled: true } });
    };

    if (userRole === 'visitor') {
        return null;
    }

    const mutationPending =
        createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

    return (
        <Box sx={{ mt: 2, maxWidth: 760 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                {t('visitorAccounts')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('visitorUsersImmediateHint')}
            </Typography>

            {isLoading ? (
                <Box sx={{ py: 2 }}>
                    <CircularProgress size={24} />
                </Box>
            ) : isError ? (
                <Typography color="error" variant="body2" sx={{ mb: 2 }}>
                    {t('unexpectedErrorOccurred')}
                </Typography>
            ) : users.length === 0 ? (
                <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
                    {t('noVisitorUsers')}
                </Typography>
            ) : (
                <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 2 }}>
                    <Table size="small" aria-label={t('visitorAccounts')}>
                        <TableHead>
                            <TableRow>
                                <TableCell>{t('username')}</TableCell>
                                <TableCell>{t('userStatus')}</TableCell>
                                <TableCell>{t('userLastLogin')}</TableCell>
                                <TableCell align="right">{t('userActions')}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {users.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell>
                                        <Stack direction="row" alignItems="center" spacing={0.75}>
                                            <Typography variant="body2">{user.username}</Typography>
                                            {user.isLegacyShared && (
                                                <Tooltip title={t('legacySharedUserTooltip')}>
                                                    <InfoOutlinedIcon color="action" fontSize="small" />
                                                </Tooltip>
                                            )}
                                        </Stack>
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            size="small"
                                            label={user.enabled ? t('userEnabled') : t('userDisabled')}
                                            color={user.enabled ? 'success' : 'default'}
                                            variant={user.enabled ? 'filled' : 'outlined'}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {formatLastLogin(user.lastLoginAt) ?? t('userNeverLoggedIn')}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                            <Tooltip title={t('editVisitorUser')}>
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => openEditDialog(user)}
                                                        disabled={mutationPending}
                                                        aria-label={t('editVisitorUser')}
                                                    >
                                                        <EditIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                            <Tooltip title={user.enabled ? t('disableUser') : t('enableUser')}>
                                                <span>
                                                    <Switch
                                                        size="small"
                                                        checked={user.enabled}
                                                        onChange={(event) => handleToggleEnabled(user, event.target.checked)}
                                                        disabled={mutationPending}
                                                        slotProps={{
                                                            input: {
                                                                'aria-label': user.enabled ? t('disableUser') : t('enableUser'),
                                                            },
                                                        }}
                                                    />
                                                </span>
                                            </Tooltip>
                                            <Tooltip title={t('deleteUser')}>
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        color="error"
                                                        onClick={() => setConfirmDeleteUser(user)}
                                                        disabled={mutationPending}
                                                        aria-label={t('deleteUser')}
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </Stack>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={openCreateDialog}
                disabled={!queryEnabled || mutationPending}
            >
                {t('addVisitorUser')}
            </Button>

            <Dialog
                open={dialogMode !== null}
                onClose={() => {
                    if (!mutationPending) {
                        closeDialog();
                    }
                }}
                disableEscapeKeyDown={mutationPending}
                fullWidth
                maxWidth="sm"
            >
                <DialogHeader
                    title={dialogMode === 'create' ? t('addVisitorUser') : t('editVisitorUser')}
                    onClose={closeDialog}
                    closeDisabled={mutationPending}
                />
                <Box component="form" onSubmit={handleSubmit}>
                    <DialogContent dividers>
                        <TextField
                            autoFocus
                            fullWidth
                            margin="dense"
                            label={t('username')}
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            error={usernameError}
                            helperText={usernameError ? t('userUsernameInvalid') : ' '}
                            disabled={mutationPending}
                        />
                        {dialogMode === 'edit' && (
                            <FormControlLabel
                                sx={{ mt: 1 }}
                                control={
                                    <Switch
                                        checked={setNewPassword}
                                        onChange={(event) => {
                                            setSetNewPassword(event.target.checked);
                                            setPassword('');
                                        }}
                                    />
                                }
                                label={t('setNewPassword')}
                            />
                        )}
                        {passwordRequired && (
                            <>
                                <TextField
                                    fullWidth
                                    margin="dense"
                                    label={t('password')}
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    error={passwordError}
                                    helperText={passwordError ? t('userPasswordInvalid') : ' '}
                                    disabled={mutationPending}
                                    slotProps={{
                                        input: {
                                            endAdornment: (
                                                <InputAdornment position="end">
                                                    <IconButton
                                                        aria-label={t('togglePasswordVisibility')}
                                                        onClick={() => setShowPassword((current) => !current)}
                                                        edge="end"
                                                    >
                                                        {showPassword ? <VisibilityOff /> : <Visibility />}
                                                    </IconButton>
                                                </InputAdornment>
                                            )
                                        }
                                    }}
                                />
                                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                                    <Button
                                        variant="outlined"
                                        startIcon={<AddIcon />}
                                        onClick={handleGeneratePassword}
                                        disabled={mutationPending}
                                    >
                                        {t('generatePassword')}
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        startIcon={<ContentCopyIcon />}
                                        onClick={handleCopyPassword}
                                        disabled={!password || mutationPending}
                                    >
                                        {t('copyPassword')}
                                    </Button>
                                </Stack>
                                {dialogMode === 'edit' && (
                                    <Typography color="warning.main" variant="body2" sx={{ mt: 2 }}>
                                        {t('userPasswordChangeWarning')}
                                    </Typography>
                                )}
                            </>
                        )}
                    </DialogContent>
                    <DialogActions sx={{ p: 2 }}>
                        <Button onClick={closeDialog} color="inherit" disabled={mutationPending}>
                            {t('cancel')}
                        </Button>
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={!canSubmit}
                            loading={createMutation.isPending || updateMutation.isPending}
                            loadingPosition="start"
                        >
                            {t('save')}
                        </Button>
                    </DialogActions>
                </Box>
            </Dialog>

            <ConfirmationModal
                isOpen={confirmDisableUser !== null}
                onClose={() => setConfirmDisableUser(null)}
                onConfirm={async () => {
                    if (confirmDisableUser) {
                        await runMutationAsync(updateMutation, { id: confirmDisableUser.id, patch: { enabled: false } });
                    }
                }}
                title={t('disableUser')}
                message={t('userDisableConfirm')}
                confirmText={t('disableUser')}
                cancelText={t('cancel')}
                isDanger
            />

            <ConfirmationModal
                isOpen={confirmDeleteUser !== null}
                onClose={() => setConfirmDeleteUser(null)}
                onConfirm={async () => {
                    if (confirmDeleteUser) {
                        await runMutationAsync(deleteMutation, confirmDeleteUser.id);
                    }
                }}
                title={t('deleteUser')}
                message={t('userDeleteConfirm')}
                confirmText={t('deleteUser')}
                cancelText={t('cancel')}
                isDanger
            />

            <AlertModal
                open={alertOpen}
                onClose={() => setAlertOpen(false)}
                title={alertTitle}
                message={alertMessage}
            />
        </Box>
    );
};

export default UserManagementSettings;
