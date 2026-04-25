import { Visibility, VisibilityOff } from '@mui/icons-material';
import {
    IconButton,
    InputAdornment,
    TextField,
} from '@mui/material';
import type { ChangeEvent } from 'react';
import type { TranslateFn } from '../../utils/translateOrFallback';

interface PasswordFieldProps {
    autoComplete?: string;
    autoFocus: boolean;
    disabled: boolean;
    helperText?: string;
    id: string;
    label: string;
    name: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onToggleVisibility: () => void;
    showPassword: boolean;
    t: TranslateFn;
    value: string;
}

export const PasswordField: React.FC<PasswordFieldProps> = ({
    autoComplete,
    autoFocus,
    disabled,
    helperText,
    id,
    label,
    name,
    onChange,
    onToggleVisibility,
    showPassword,
    t,
    value,
}) => (
    <TextField
        margin="normal"
        required
        fullWidth
        name={name}
        label={label}
        type={showPassword ? 'text' : 'password'}
        id={id}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        autoFocus={autoFocus}
        disabled={disabled}
        helperText={helperText}
        slotProps={{
            input: {
                endAdornment: (
                    <InputAdornment position="end">
                        <IconButton
                            aria-label={t('togglePasswordVisibility')}
                            onClick={onToggleVisibility}
                            edge="end"
                        >
                            {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                    </InputAdornment>
                ),
            },
        }}
    />
);
