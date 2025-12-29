
import { describe, expect, it, vi } from 'vitest';
import * as ytDlpUtils from '../../utils/ytDlpUtils';

// Mock dependencies
vi.mock('child_process', () => ({
    spawn: vi.fn(),
}));
vi.mock('fs-extra');
vi.mock('../../utils/logger');

describe('ytDlpUtils', () => {
    describe('convertFlagToArg', () => {
        it('should convert camelCase to kebab-case', () => {
            expect(ytDlpUtils.convertFlagToArg('minSleepInterval')).toBe('--min-sleep-interval');
        });

        it('should handle single letters', () => {
            expect(ytDlpUtils.convertFlagToArg('f')).toBe('--f');
        });
    });

    describe('flagsToArgs', () => {
        it('should convert flags object to args array', () => {
            const flags = { format: 'best', verbose: true, output: 'out.mp4' };
            const args = ytDlpUtils.flagsToArgs(flags);
            
            expect(args).toContain('--format');
            expect(args).toContain('best');
            expect(args).toContain('--verbose');
            expect(args).toContain('--output');
            expect(args).toContain('out.mp4');
        });

        it('should handle boolean flags', () => {
            expect(ytDlpUtils.flagsToArgs({ verbose: true })).toContain('--verbose');
            expect(ytDlpUtils.flagsToArgs({ verbose: false })).not.toContain('--verbose');
        });
    });

    describe('parseYtDlpConfig', () => {
        it('should parse config file text', () => {
            const config = `
            # Comment
            --format best
            --output %(title)s.%(ext)s
            --no-mtime
            `;
            const parsed = ytDlpUtils.parseYtDlpConfig(config);
            
            expect(parsed.format).toBe('best');
            expect(parsed.output).toBe('%(title)s.%(ext)s');
            expect(parsed.noMtime).toBe(true);
        });
    });
});
