import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFileListCache, getFileList, getFilesRecursively } from '../fileLister';
import { CloudDriveConfig } from '../types';

vi.mock('axios');

describe('cloudStorage fileLister', () => {
    const mockConfig: CloudDriveConfig = {
        enabled: true,
        apiUrl: 'https://api.example.com/api/fs/put',
        token: 'test-token',
        uploadPath: '/uploads',
        publicUrl: 'https://cdn.example.com',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        clearFileListCache();
    });

    describe('getFileList', () => {
        it('should return files from API', async () => {
            const mockFiles = [{ name: 'file1.txt', is_dir: false }];
            vi.mocked(axios.post).mockResolvedValue({
                data: {
                    code: 200,
                    data: { content: mockFiles }
                }
            });

            const files = await getFileList(mockConfig, '/uploads');
            
            expect(files).toEqual(mockFiles);
            expect(axios.post).toHaveBeenCalledWith(
                'https://api.example.com/api/fs/list',
                expect.objectContaining({ path: '/uploads' }),
                expect.any(Object)
            );
        });

        it('should return empty list on API error', async () => {
            vi.mocked(axios.post).mockRejectedValue(new Error('API Error'));
            
            const files = await getFileList(mockConfig, '/uploads');
            expect(files).toEqual([]);
        });

        it('should return empty list if response code is not 200', async () => {
            vi.mocked(axios.post).mockResolvedValue({
                data: { code: 500, message: 'Server Error' }
            });
            
            const files = await getFileList(mockConfig, '/uploads');
            expect(files).toEqual([]);
        });

        it('should cache results', async () => {
            const mockFiles = [{ name: 'file1.txt', is_dir: false }];
            vi.mocked(axios.post).mockResolvedValue({
                data: {
                    code: 200,
                    data: { content: mockFiles }
                }
            });

            // First call
            await getFileList(mockConfig, '/uploads');
            
            // Second call
            const files = await getFileList(mockConfig, '/uploads');
            
            expect(files).toEqual(mockFiles);
            expect(axios.post).toHaveBeenCalledTimes(1);
        });
    });

    describe('getFilesRecursively', () => {
        it('should recursively fetch files from directories', async () => {
            // Mock responses for different paths
            vi.mocked(axios.post).mockImplementation(async (url, body: any) => {
                if (body.path === '/uploads') {
                    return {
                        data: {
                            code: 200,
                            data: {
                                content: [
                                    { name: 'root.txt', is_dir: false },
                                    { name: 'subdir', is_dir: true }
                                ]
                            }
                        }
                    };
                }
                if (body.path === '/uploads/subdir') {
                    return {
                        data: {
                            code: 200,
                            data: {
                                content: [
                                    { name: 'nested.txt', is_dir: false }
                                ]
                            }
                        }
                    };
                }
                return { data: { code: 200, data: { content: [] } } };
            });

            const result = await getFilesRecursively(mockConfig, '/uploads');
            
            expect(result).toHaveLength(2);
            expect(result).toEqual(expect.arrayContaining([
                expect.objectContaining({ path: '/uploads/root.txt' }),
                expect.objectContaining({ path: '/uploads/subdir/nested.txt' })
            ]));
        });

         it('should return whatever it found locally if recursion fails', async () => {
            // Mock success for root, failure for subdir
             vi.mocked(axios.post).mockImplementation(async (url, body: any) => {
                if (body.path === '/uploads') {
                    return {
                        data: {
                            code: 200,
                            data: {
                                content: [
                                    { name: 'subdir', is_dir: true }
                                ]
                            }
                        }
                    };
                }
                throw new Error('Recursion Error');
            });
            
            const result = await getFilesRecursively(mockConfig, '/uploads');
            // Should verify that log was called but function doesn't crash
            // Result might be empty because the loop awaits for recursion
            // Actually, in the implementation:
            // for (file of files) {
            //   if file.is_dir wait getFilesRecursively
            // }
            // If getFilesRecursively throws inside loop -> catch in main function?
            // Wait, getFilesRecursively has a try-catch block wrapping everything.
            // But if the recursive call *inside* the loop fails, does it throw?
            // The recursive call calls `getFilesRecursively`.
            // `getFilesRecursively` catches errors and returns allFiles.
            // So it should not throw and return what it has.
            
            expect(result).toEqual([]);
        });
    });
});
