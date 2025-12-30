import { describe, expect, it } from 'vitest';
import * as continuousDownload from '../index';
import { TaskCleanup } from '../taskCleanup';
import { TaskProcessor } from '../taskProcessor';
import { TaskRepository } from '../taskRepository';
import { VideoUrlFetcher } from '../videoUrlFetcher';

describe('continuousDownload index', () => {
    it('should export modules correctly', () => {
        expect(continuousDownload.TaskCleanup).toBe(TaskCleanup);
        expect(continuousDownload.TaskProcessor).toBe(TaskProcessor);
        expect(continuousDownload.TaskRepository).toBe(TaskRepository);
        expect(continuousDownload.VideoUrlFetcher).toBe(VideoUrlFetcher);
    });
});
