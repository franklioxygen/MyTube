import * as fs from 'fs-extra';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIDEOS_DIR } from '../../config/paths';
import { cleanupVideoArtifacts } from '../../utils/downloadUtils';

const TEST_DIR = path.join(VIDEOS_DIR, 'temp_cleanup_artifacts_test');

describe('cleanupVideoArtifacts', () => {
  beforeEach(async () => {
    await fs.ensureDir(TEST_DIR);
  });

  afterEach(async () => {
    if (await fs.pathExists(TEST_DIR)) {
      await fs.remove(TEST_DIR);
    }
  });

  it('should remove .part files', async () => {
    const baseName = 'video_123';
    const filePath = path.join(TEST_DIR, `${baseName}.mp4.part`);
    await fs.ensureFile(filePath);
    
    await cleanupVideoArtifacts(baseName, TEST_DIR);
    
    expect(await fs.pathExists(filePath)).toBe(false);
  });

  it('should remove .ytdl files', async () => {
    const baseName = 'video_123';
    const filePath = path.join(TEST_DIR, `${baseName}.mp4.ytdl`);
    await fs.ensureFile(filePath);
    
    await cleanupVideoArtifacts(baseName, TEST_DIR);
    
    expect(await fs.pathExists(filePath)).toBe(false);
  });

  it('should remove intermediate format files (.f137.mp4)', async () => {
    const baseName = 'video_123';
    const filePath = path.join(TEST_DIR, `${baseName}.f137.mp4`);
    await fs.ensureFile(filePath);
    
    await cleanupVideoArtifacts(baseName, TEST_DIR);
    
    expect(await fs.pathExists(filePath)).toBe(false);
  });

  it('should remove partial files with intermediate formats (.f137.mp4.part)', async () => {
    const baseName = 'video_123';
    const filePath = path.join(TEST_DIR, `${baseName}.f137.mp4.part`);
    await fs.ensureFile(filePath);
    
    await cleanupVideoArtifacts(baseName, TEST_DIR);
    
    expect(await fs.pathExists(filePath)).toBe(false);
  });
  
  it('should remove temp files (.temp.mp4)', async () => {
      const baseName = 'video_123';
      const filePath = path.join(TEST_DIR, `${baseName}.temp.mp4`);
      await fs.ensureFile(filePath);
      
      await cleanupVideoArtifacts(baseName, TEST_DIR);
      
      expect(await fs.pathExists(filePath)).toBe(false);
  });

  it('should NOT remove unrelated files', async () => {
    const baseName = 'video_123';
    const unrelatedFile = path.join(TEST_DIR, 'video_456.mp4.part');
    await fs.ensureFile(unrelatedFile);
    
    await cleanupVideoArtifacts(baseName, TEST_DIR);
    
    expect(await fs.pathExists(unrelatedFile)).toBe(true);
  });
});
