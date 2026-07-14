import { Person } from '@mui/icons-material';
import { Avatar, Box, Card, CardActionArea, CircularProgress, Container, Typography } from '@mui/material';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { useCloudStorageUrl } from '../hooks/useCloudStorageUrl';
import { brand, modeColors } from '../theme/colors';
import { Video } from '../types';

interface AuthorSummary {
    author: string;
    avatarPath?: string | null;
    videoCount: number;
}

const AuthorCard: React.FC<{ summary: AuthorSummary; videosLabel: string }> = ({ summary, videosLabel }) => {
    const avatarUrl = useCloudStorageUrl(summary.avatarPath, 'thumbnail');

    return (
        <Card
            sx={{
                bgcolor: 'transparent',
                boxShadow: 'none',
                border: 'none',
            }}
        >
            <CardActionArea
                component={Link}
                to={`/author/${encodeURIComponent(summary.author)}`}
                sx={{
                    p: { xs: 1, md: 1.5 },
                    borderRadius: 3,
                    '&:hover .all-authors-ring': { transform: 'scale(1.06)' },
                }}
            >
                {/* Gradient ring frames the avatar for a consistent, premium look */}
                <Box
                    className="all-authors-ring"
                    sx={{
                        width: { xs: 72, md: 100 },
                        height: { xs: 72, md: 100 },
                        mx: 'auto',
                        borderRadius: '50%',
                        p: '3px',
                        background: (theme) => `linear-gradient(135deg, ${brand.primaryDark}, ${modeColors(theme.palette.mode).secondary})`,
                        transition: 'transform 0.2s ease',
                    }}
                >
                    <Avatar
                        src={avatarUrl || undefined}
                        alt={summary.author}
                        sx={{ width: '100%', height: '100%' }}
                    >
                        {summary.author ? summary.author.charAt(0).toUpperCase() : <Person />}
                    </Avatar>
                </Box>
                <Typography
                    variant="body2"
                    align="center"
                    fontWeight={600}
                    sx={{ mt: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {summary.author}
                </Typography>
                <Typography variant="caption" color="text.secondary" align="center" display="block" noWrap>
                    {summary.videoCount} {videosLabel}
                </Typography>
            </CardActionArea>
        </Card>
    );
};

const buildAuthorSummaries = (videos: Video[]): AuthorSummary[] => {
    const map = new Map<string, AuthorSummary>();

    videos.forEach((video) => {
        if (!video.author) return;

        const existing = map.get(video.author);
        if (existing) {
            existing.videoCount += 1;
            if (!existing.avatarPath && video.authorAvatarPath) {
                existing.avatarPath = video.authorAvatarPath;
            }
        } else {
            map.set(video.author, {
                author: video.author,
                avatarPath: video.authorAvatarPath,
                videoCount: 1,
            });
        }
    });

    return [...map.values()].sort((a, b) => a.author.localeCompare(b.author));
};

const AllAuthorsPage: React.FC = () => {
    const { t } = useLanguage();
    const { videos, loading } = useVideo();

    const authors = useMemo(() => buildAuthorSummaries(videos), [videos]);

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
                {t('allAuthors')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {authors.length} {t('authors')}
            </Typography>

            {authors.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                    {t('noVideos')}
                </Typography>
            ) : (
                <Box
                    sx={{
                        display: 'grid',
                        // Fluid columns via auto-fill so cards never overflow on
                        // narrow phones: each column is at least the card's min
                        // width and stretches to fill. `xs` has no intermediate
                        // breakpoint (0–599px), so a fixed column count can't fit
                        // both 320px and 599px well.
                        gridTemplateColumns: {
                            xs: 'repeat(auto-fill, minmax(96px, 1fr))',
                            sm: 'repeat(auto-fill, minmax(120px, 1fr))',
                            md: 'repeat(auto-fill, minmax(150px, 1fr))',
                        },
                        gap: 1,
                    }}
                >
                    {authors.map((summary) => (
                        <AuthorCard key={summary.author} summary={summary} videosLabel={t('videos')} />
                    ))}
                </Box>
            )}
        </Container>
    );
};

export default AllAuthorsPage;
