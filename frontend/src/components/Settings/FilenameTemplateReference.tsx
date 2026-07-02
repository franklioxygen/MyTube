import { Box, Typography } from '@mui/material';
import React from 'react';
import CollapsibleSection from '../CollapsibleSection';
import { useLanguage } from '../../contexts/LanguageContext';
import {
    FilenameTemplateInformationNote,
    FilenameTemplateReferenceSection,
} from './filenameTemplateShared';

interface FilenameTemplateReferenceProps {
    informationNotes: FilenameTemplateInformationNote[];
    referenceSections: FilenameTemplateReferenceSection[];
}

/** Collapsible token/pattern reference rendered from the backend catalog. */
const FilenameTemplateReference: React.FC<FilenameTemplateReferenceProps> = ({
    informationNotes,
    referenceSections,
}) => {
    const { t } = useLanguage();

    return (
        <Box sx={{ mt: 3, maxWidth: 920 }}>
            <CollapsibleSection title={t('filenameRefInformationTitle')} defaultExpanded={false}>
                <Box sx={{ mb: 2 }}>
                    {informationNotes.map((note) => (
                        <Typography
                            key={note.id}
                            variant="body2"
                            color="text.secondary"
                            sx={{ mb: 0.75 }}
                        >
                            {t(note.textKey)}
                        </Typography>
                    ))}
                </Box>

                {referenceSections.map((section) => (
                    <Box key={section.id} sx={{ mb: 2.5 }}>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                            {t(section.titleKey)}
                        </Typography>
                        {section.descriptionKey && (
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mb: 1.25 }}
                            >
                                {t(section.descriptionKey)}
                            </Typography>
                        )}
                        <Box
                            sx={{
                                display: 'grid',
                                gap: 1,
                            }}
                        >
                            {section.items.map((item) => (
                                <Box
                                    key={item.key}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: {
                                            xs: '1fr',
                                            md: '260px minmax(0, 1fr) 180px',
                                        },
                                        gap: 1,
                                        p: 1.25,
                                        borderRadius: 1.5,
                                        bgcolor: 'action.hover',
                                    }}
                                >
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            fontFamily: 'monospace',
                                            wordBreak: 'break-all',
                                        }}
                                    >
                                        {item.token}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {t(item.descriptionKey)}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        sx={{
                                            fontFamily: item.example ? 'monospace' : undefined,
                                            wordBreak: 'break-all',
                                        }}
                                    >
                                        {item.example || ''}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                ))}
            </CollapsibleSection>
        </Box>
    );
};

export default FilenameTemplateReference;
