import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db';
import { continuousDownloadTasks } from '../../../db/schema';
import { TaskRepository } from '../../../services/continuousDownload/taskRepository';
import { ContinuousDownloadTask } from '../../../services/continuousDownload/types';

// Mock DB
vi.mock('../../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  }
}));

vi.mock('../../../db/schema', () => ({
  continuousDownloadTasks: {
    id: 'id',
    collectionId: 'collectionId',
    status: 'status',
    // ... other fields for referencing
  },
  collections: {
    id: 'id',
    name: 'name'
  }
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  }
}));

describe('TaskRepository', () => {
  let taskRepository: TaskRepository;
  let mockBuilder: any;

  // Chainable builder mock
  const createMockQueryBuilder = (result: any) => {
    const builder: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(result).then(resolve)
    };
    return builder;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskRepository = new TaskRepository();
    
    // Default empty result
    mockBuilder = createMockQueryBuilder([]);
    
    (db.select as any).mockReturnValue(mockBuilder);
    (db.insert as any).mockReturnValue(mockBuilder);
    (db.delete as any).mockReturnValue(mockBuilder);
    (db.update as any).mockReturnValue(mockBuilder);
  });

  it('createTask should insert task', async () => {
    const task: ContinuousDownloadTask = { 
        id: 'task-1', 
        author: 'Author', 
        authorUrl: 'url',
        platform: 'YouTube',
        status: 'active',
        createdAt: 0,
        currentVideoIndex: 0,
        totalVideos: 0,
        downloadedCount: 0,
        skippedCount: 0,
        failedCount: 0
    };
    
    await taskRepository.createTask(task);
    
    expect(db.insert).toHaveBeenCalledWith(continuousDownloadTasks);
    expect(mockBuilder.values).toHaveBeenCalled();
  });

  it('getAllTasks should select tasks with playlist names', async () => {
    const mockData = [
        { 
            task: { id: '1', status: 'active', author: 'A' }, 
            playlistName: 'My Playlist' 
        }
    ];
    mockBuilder.then = (cb: any) => Promise.resolve(mockData).then(cb);
    
    const tasks = await taskRepository.getAllTasks();
    
    expect(db.select).toHaveBeenCalled();
    expect(mockBuilder.from).toHaveBeenCalledWith(continuousDownloadTasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('1');
    expect(tasks[0].playlistName).toBe('My Playlist');
  });

  it('getTaskById should return task if found', async () => {
    const mockData = [
        { 
            task: { id: '1', status: 'active', author: 'A' }, 
            playlistName: 'My Playlist' 
        }
    ];
    mockBuilder.then = (cb: any) => Promise.resolve(mockData).then(cb);

    const task = await taskRepository.getTaskById('1');
    
    expect(db.select).toHaveBeenCalled();
    expect(mockBuilder.where).toHaveBeenCalled();
    expect(task).toBeDefined();
    expect(task?.id).toBe('1');
  });

  it('getTaskById should return null if not found', async () => {
    mockBuilder.then = (cb: any) => Promise.resolve([]).then(cb);
    
    const task = await taskRepository.getTaskById('non-existent');
    
    expect(task).toBeNull();
  });

  it('updateProgress should update stats', async () => {
    await taskRepository.updateProgress('1', { downloadedCount: 5 });
    
    expect(db.update).toHaveBeenCalledWith(continuousDownloadTasks);
    expect(mockBuilder.set).toHaveBeenCalledWith(expect.objectContaining({
        downloadedCount: 5
    }));
    expect(mockBuilder.where).toHaveBeenCalled();
  });

  it('completeTask should set status to completed', async () => {
    await taskRepository.completeTask('1');
    
    expect(db.update).toHaveBeenCalledWith(continuousDownloadTasks);
    expect(mockBuilder.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed'
    }));
  });

  it('deleteTask should delete task', async () => {
    await taskRepository.deleteTask('1');
    
    expect(db.delete).toHaveBeenCalledWith(continuousDownloadTasks);
    expect(mockBuilder.where).toHaveBeenCalled();
  });
});
