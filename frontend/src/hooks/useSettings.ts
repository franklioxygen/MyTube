import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Settings } from '../types';

const API_URL = import.meta.env.VITE_API_URL;

export const useSettings = () => {
    return useQuery<Settings>({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        }
    });
};
