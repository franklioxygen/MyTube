import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionProvider, useCollection } from '../CollectionContext';
import { LanguageProvider } from '../LanguageContext';
import { SnackbarProvider } from '../SnackbarContext';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Mock AuthContext
vi.mock('../AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        userRole: 'admin',
        login: vi.fn(),
        logout: vi.fn(),
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Wrappers
const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <SnackbarProvider>
                <LanguageProvider>
                    <CollectionProvider>{children}</CollectionProvider>
                </LanguageProvider>
            </SnackbarProvider>
        </QueryClientProvider>
    );
};

describe('CollectionContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Mock global localStorage
        const storageMock: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: vi.fn((key) => storageMock[key] || null),
                setItem: vi.fn((key, value) => {
                    storageMock[key] = value.toString();
                }),
                clear: vi.fn(() => {
                    for (const key in storageMock) delete storageMock[key];
                }),
                removeItem: vi.fn((key) => delete storageMock[key]),
                length: 0,
                key: vi.fn(),
            },
            writable: true
        });

        // Default mocks
        mockedAxios.get.mockResolvedValue({ data: [] });
    });

    it('should provide collections data', async () => {
        const mockCollections = [{ id: '1', name: 'My Collection', videos: [] }];
        mockedAxios.get.mockResolvedValueOnce({ data: mockCollections });

        const { result } = renderHook(() => useCollection(), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.collections).toEqual(mockCollections);
        });
    });

    it('should create a collection', async () => {
        const mockCollection = { id: 'new', name: 'New Col', videos: ['v1'] };
        mockedAxios.post.mockResolvedValueOnce({ data: mockCollection });

        const { result } = renderHook(() => useCollection(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.createCollection('New Col', 'v1');
        });

        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.stringContaining('/collections'),
            { name: 'New Col', videoId: 'v1' }
        );
    });

    it('should add video to collection', async () => {
        mockedAxios.put.mockResolvedValueOnce({ data: { success: true } });

        const { result } = renderHook(() => useCollection(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.addToCollection('col1', 'vid1');
        });

        expect(mockedAxios.put).toHaveBeenCalledWith(
            expect.stringContaining('/collections/col1'),
            { videoId: 'vid1', action: 'add' }
        );
    });

    it('should remove video from collection', async () => {
        const mockCollections = [{ id: '1', name: 'C1', videos: ['vid1'] }];
        // First get is initialization
        mockedAxios.get.mockResolvedValueOnce({ data: mockCollections });

        const { result } = renderHook(() => useCollection(), { wrapper: createWrapper() });

        // Wait for load
        await waitFor(() => {
            expect(result.current.collections).toHaveLength(1);
        });

        mockedAxios.put.mockResolvedValueOnce({ data: { success: true } });

        await act(async () => {
            await result.current.removeFromCollection('vid1');
        });

        expect(mockedAxios.put).toHaveBeenCalledWith(
            expect.stringContaining('/collections/1'),
            { videoId: 'vid1', action: 'remove' }
        );
    });

    it('should delete a collection', async () => {
        mockedAxios.delete.mockResolvedValueOnce({ data: { success: true } });

        const { result } = renderHook(() => useCollection(), { wrapper: createWrapper() });

        await act(async () => {
            const res = await result.current.deleteCollection('col1');
            expect(res.success).toBe(true);
        });

        expect(mockedAxios.delete).toHaveBeenCalledWith(
            expect.stringContaining('/collections/col1'),
            expect.anything()
        );
    });
});
