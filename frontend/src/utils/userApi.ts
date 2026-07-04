import { VisitorUser } from '../types';
import { api } from './apiClient';

export interface CreateVisitorUserInput {
    username: string;
    password: string;
}

export interface UpdateVisitorUserInput {
    username?: string;
    password?: string;
    enabled?: boolean;
}

export const userApi = {
    fetchUsers: async (): Promise<VisitorUser[]> => {
        const response = await api.get<{ success: boolean; users: VisitorUser[] }>('/users');
        return response.data.users;
    },
    createUser: async (data: CreateVisitorUserInput): Promise<VisitorUser> => {
        const response = await api.post<{ success: boolean; user: VisitorUser }>('/users', data);
        return response.data.user;
    },
    updateUser: async (id: string, patch: UpdateVisitorUserInput): Promise<VisitorUser> => {
        const response = await api.patch<{ success: boolean; user: VisitorUser }>(`/users/${id}`, patch);
        return response.data.user;
    },
    deleteUser: async (id: string): Promise<void> => {
        await api.delete(`/users/${id}`);
    },
};
