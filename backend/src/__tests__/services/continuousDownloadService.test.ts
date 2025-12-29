
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContinuousDownloadService } from '../../services/continuousDownloadService';

// Mock dependencies
vi.mock('../../utils/logger');
vi.mock('../../services/continuousDownload/taskRepository', () => ({
    TaskRepository: vi.fn().mockImplementation(() => ({
        createTask: vi.fn().mockResolvedValue(undefined),
        getAllTasks: vi.fn().mockResolvedValue([]),
        getTaskById: vi.fn(),
        cancelTask: vi.fn(),
        deleteTask: vi.fn(),
        cancelTaskWithError: vi.fn()
    }))
}));
vi.mock('../../services/continuousDownload/videoUrlFetcher');
vi.mock('../../services/continuousDownload/taskCleanup');
vi.mock('../../services/continuousDownload/taskProcessor', () => ({
    TaskProcessor: vi.fn().mockImplementation(() => ({
        processTask: vi.fn()
    }))
}));

describe('ContinuousDownloadService', () => {
    let service: ContinuousDownloadService;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton instance if possible, or just use getInstance
        // Helper to reset private static instance would be ideal but for now we just get it
        service = ContinuousDownloadService.getInstance();
    });

    describe('createTask', () => {
        it('should create and start a task', async () => {
            const task = await service.createTask('http://example.com', 'User', 'YouTube');
            
            expect(task).toBeDefined();
            expect(task.authorUrl).toBe('http://example.com');
            expect(task.status).toBe('active');
        });
    });

    describe('createPlaylistTask', () => {
        it('should create a playlist task', async () => {
            const task = await service.createPlaylistTask('http://example.com/playlist', 'User', 'YouTube', 'col-1');

            expect(task).toBeDefined();
            expect(task.collectionId).toBe('col-1');
            expect(task.status).toBe('active');
        });
    });

    describe('cancelTask', () => {
        it('should cancel existing task', async () => {
             // Mock repository behavior
             const mockTask = { id: 'task-1', status: 'active', authorUrl: 'url' };
             (service as any).taskRepository.getTaskById.mockResolvedValue(mockTask);

             await service.cancelTask('task-1');

             expect((service as any).taskRepository.cancelTask).toHaveBeenCalledWith('task-1');
        });

        it('should throw if task not found', async () => {
            (service as any).taskRepository.getTaskById.mockResolvedValue(null);
            
            await expect(service.cancelTask('missing')).rejects.toThrow('Task missing not found');
        });
    });
});
