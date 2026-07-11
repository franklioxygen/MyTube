import { SentimentSatisfiedOutlined } from '@mui/icons-material';
import { Box, Button, Typography } from '@mui/material';
import { useLanguage } from '../../contexts/LanguageContext';

interface FavoriteEmptyStateProps {
    onBrowseCollections: () => void;
    onFindAuthors: () => void;
}

const FavoriteEmptyState: React.FC<FavoriteEmptyStateProps> = ({ onBrowseCollections, onFindAuthors }) => {
    const { t } = useLanguage();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', py: { xs: 8, md: 12 }, px: 2 }}>
            <SentimentSatisfiedOutlined sx={{ fontSize: 72, color: 'primary.main', mb: 2 }} />
            <Typography variant="h4" fontWeight={700}>{t('favoritesEmptyTitle')}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 480 }}>{t('favoritesEmptySubtitle')}</Typography>
            <Box sx={{ display: 'flex', gap: 1.5, mt: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Button variant="contained" onClick={onBrowseCollections}>{t('browseCollections')}</Button>
                <Button variant="outlined" onClick={onFindAuthors}>{t('findAuthors')}</Button>
            </Box>
        </Box>
    );
};

export default FavoriteEmptyState;
