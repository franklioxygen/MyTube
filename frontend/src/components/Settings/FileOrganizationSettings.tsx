import {
    Alert,
    Box,
    Button,
    FormControl,
    FormControlLabel,
    Radio,
    RadioGroup,
    Switch,
    Typography
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import type { AuthorOrganizationMode, Settings } from '../../types';

interface FileOrganizationSettingsProps {
    onFormatFilenames: () => void;
    onCleanupAuthorCollections: () => void;
    isSaving: boolean;
    moveSubtitlesToVideoFolder: boolean;
    onMoveSubtitlesToVideoFolderChange: (checked: boolean) => void;
    moveThumbnailsToVideoFolder: boolean;
    onMoveThumbnailsToVideoFolderChange: (checked: boolean) => void;
    authorOrganizationMode: AuthorOrganizationMode;
    onAuthorOrganizationModeChange: (mode: AuthorOrganizationMode) => void;
    downloadFilenameMode?: Settings['downloadFilenameMode'];
}

/**
 * Where downloaded files live on disk and what they are called. Split out of
 * DatabaseSettings, which kept these next to database import/export purely for
 * historical reasons - they belong beside the filename template that produces
 * the names these controls then rearrange.
 */
const FileOrganizationSettings: React.FC<FileOrganizationSettingsProps> = ({
    onFormatFilenames,
    onCleanupAuthorCollections,
    isSaving,
    moveSubtitlesToVideoFolder,
    onMoveSubtitlesToVideoFolderChange,
    moveThumbnailsToVideoFolder,
    onMoveThumbnailsToVideoFolderChange,
    authorOrganizationMode,
    onAuthorOrganizationModeChange,
    downloadFilenameMode
}) => {
    const { t } = useLanguage();

    return (
        <Box>
            <Box id="moveSubtitlesToVideoFolder-setting">
                <Typography variant="h6" gutterBottom>{t('moveSubtitlesToVideoFolder')}</Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={moveSubtitlesToVideoFolder}
                            onChange={(e) => onMoveSubtitlesToVideoFolderChange(e.target.checked)}
                            disabled={isSaving}
                        />
                    }
                    label={moveSubtitlesToVideoFolder ? t('moveSubtitlesToVideoFolderOn') : t('moveSubtitlesToVideoFolderOff')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('moveSubtitlesToVideoFolderDescription')}
                </Typography>
            </Box>

            <Box sx={{ mt: 3 }} id="moveThumbnailsToVideoFolder-setting">
                <Typography variant="h6" gutterBottom>{t('moveThumbnailsToVideoFolder')}</Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={moveThumbnailsToVideoFolder}
                            onChange={(e) => onMoveThumbnailsToVideoFolderChange(e.target.checked)}
                            disabled={isSaving}
                        />
                    }
                    label={moveThumbnailsToVideoFolder ? t('moveThumbnailsToVideoFolderOn') : t('moveThumbnailsToVideoFolderOff')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('moveThumbnailsToVideoFolderDescription')}
                </Typography>
            </Box>

            <Box sx={{ mt: 3 }} id="authorOrganizationMode-setting">
                <Typography variant="h6" gutterBottom>{t('authorOrganizationMode')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                    {t('authorOrganizationModeDescription')}
                </Typography>
                <FormControl>
                    <RadioGroup
                        value={authorOrganizationMode}
                        onChange={(e) => onAuthorOrganizationModeChange(e.target.value as AuthorOrganizationMode)}
                    >
                        <FormControlLabel
                            value="root"
                            disabled={isSaving}
                            control={<Radio />}
                            label={
                                <Box>
                                    <Typography variant="body1">{t('authorOrganizationModeRoot')}</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {t('authorOrganizationModeRootDescription')}
                                    </Typography>
                                </Box>
                            }
                        />
                        <FormControlLabel
                            value="author_folder_only"
                            disabled={isSaving}
                            control={<Radio />}
                            label={
                                <Box>
                                    <Typography variant="body1">{t('authorOrganizationModeAuthorFolderOnly')}</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {t('authorOrganizationModeAuthorFolderOnlyDescription')}
                                    </Typography>
                                </Box>
                            }
                        />
                        <FormControlLabel
                            value="author_collection_linked"
                            disabled={isSaving}
                            control={<Radio />}
                            label={
                                <Box>
                                    <Typography variant="body1">{t('authorOrganizationModeAuthorCollectionLinked')}</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {t('authorOrganizationModeAuthorCollectionLinkedDescription')}
                                    </Typography>
                                </Box>
                            }
                        />
                    </RadioGroup>
                </FormControl>
                <Alert severity="info" sx={{ mt: 2, maxWidth: 760 }}>
                    {t('authorOrganizationModeRecommendation')}
                </Alert>
                {downloadFilenameMode === 'template' && (
                    <Alert severity="info" sx={{ mt: 2, maxWidth: 760 }}>
                        {t('authorOrganizationModeTemplateNote')}
                    </Alert>
                )}
                {authorOrganizationMode === 'author_folder_only' && (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle1" gutterBottom>
                            {t('cleanupAuthorCollections')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 760 }}>
                            {t('cleanupAuthorCollectionsDescription')}
                        </Typography>
                        <Button
                            variant="outlined"
                            color="warning"
                            onClick={onCleanupAuthorCollections}
                            disabled={isSaving}
                        >
                            {t('cleanupAuthorCollectionsButton')}
                        </Button>
                    </Box>
                )}
            </Box>

            <Box sx={{ mt: 3 }} id="formatLegacyFilenames-setting">
                <Typography variant="h6" gutterBottom>{t('formatLegacyFilenames')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 760 }}>
                    {t('formatLegacyFilenamesDescription')}
                </Typography>
                <Button
                    variant="outlined"
                    color="primary"
                    onClick={onFormatFilenames}
                    disabled={isSaving}
                >
                    {t('formatLegacyFilenamesButton')}
                </Button>
            </Box>
        </Box>
    );
};

export default FileOrganizationSettings;
