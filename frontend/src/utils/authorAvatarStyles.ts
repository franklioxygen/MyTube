import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';
import { neutral } from '../theme/colors';

export const authorAvatarFallbackSx = (theme: Theme): SystemStyleObject<Theme> => ({
    bgcolor: theme.palette.mode === 'dark' ? neutral.grey550 : neutral.grey300,
    color: theme.palette.mode === 'dark' ? neutral.grey200 : neutral.grey700,
});
