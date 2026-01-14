import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Settings } from '../types';
import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

export const useSettings = () => {
    return useQuery<Settings>({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        }
    });
};
