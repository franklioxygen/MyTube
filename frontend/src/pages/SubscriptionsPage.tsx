import { Delete } from '@mui/icons-material';
import {
    Button,
    Container,
    IconButton,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography
} from '@mui/material';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';

const API_URL = import.meta.env.VITE_API_URL;

interface Subscription {
    id: string;
    author: string;
    authorUrl: string;
    interval: number;
    lastVideoLink?: string;
    lastCheck?: number;
    downloadCount: number;
    createdAt: number;
    platform: string;
}

const SubscriptionsPage: React.FC = () => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

    useEffect(() => {
        fetchSubscriptions();
    }, []);

    const fetchSubscriptions = async () => {
        try {
            const response = await axios.get(`${API_URL}/subscriptions`);
            setSubscriptions(response.data);
        } catch (error) {
            console.error('Error fetching subscriptions:', error);
            showSnackbar(t('error'));
        }
    };

    const handleUnsubscribe = async (id: string, author: string) => {
        if (!window.confirm(t('confirmUnsubscribe', { author }))) {
            return;
        }

        try {
            await axios.delete(`${API_URL}/subscriptions/${id}`);
            showSnackbar(t('unsubscribedSuccessfully'));
            fetchSubscriptions();
        } catch (error) {
            console.error('Error unsubscribing:', error);
            showSnackbar(t('error'));
        }
    };

    const formatDate = (timestamp?: number) => {
        if (!timestamp) return t('never');
        return new Date(timestamp).toLocaleString();
    };

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
                {t('subscriptions')}
            </Typography>

            <TableContainer component={Paper} sx={{ mt: 3 }}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>{t('author')}</TableCell>
                            <TableCell>{t('platform')}</TableCell>
                            <TableCell>{t('interval')}</TableCell>
                            <TableCell>{t('lastCheck')}</TableCell>
                            <TableCell>{t('downloads')}</TableCell>
                            <TableCell align="right">{t('actions')}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {subscriptions.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center">
                                    <Typography color="text.secondary" sx={{ py: 4 }}>
                                        {t('noVideos')} {/* Reusing "No videos found" or similar if "No subscriptions" key missing */}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            subscriptions.map((sub) => (
                                <TableRow key={sub.id}>
                                    <TableCell>
                                        <Button
                                            href={sub.authorUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            sx={{ textTransform: 'none', justifyContent: 'flex-start', p: 0 }}
                                        >
                                            {sub.author}
                                        </Button>
                                    </TableCell>
                                    <TableCell>{sub.platform}</TableCell>
                                    <TableCell>{sub.interval} {t('minutes')}</TableCell>
                                    <TableCell>{formatDate(sub.lastCheck)}</TableCell>
                                    <TableCell>{sub.downloadCount}</TableCell>
                                    <TableCell align="right">
                                        <IconButton
                                            color="error"
                                            onClick={() => handleUnsubscribe(sub.id, sub.author)}
                                            title={t('unsubscribe')}
                                        >
                                            <Delete />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Container>
    );
};

export default SubscriptionsPage;
