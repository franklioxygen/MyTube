/**
 * Continuous Download Service Modules
 *
 * This module provides decoupled services for managing continuous download tasks:
 * - TaskRepository: Database operations for tasks
 * - VideoUrlFetcher: Fetching video URLs from different platforms
 * - TaskCleanup: Cleanup operations for tasks
 * - TaskProcessor: Processing logic for tasks
 */

export { TaskCleanup } from "./taskCleanup";
export { TaskProcessor } from "./taskProcessor";
export { TaskRepository } from "./taskRepository";
export type { ContinuousDownloadTask } from "./types";
export { VideoUrlFetcher } from "./videoUrlFetcher";
