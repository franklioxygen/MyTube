import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db';
import { DatabaseError } from '../../../errors/DownloadErrors';
import { logger } from '../../../utils/logger';
import { getSettings, saveSettings } from '../settings';

// Mock DB and Logger
vi.mock('../../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn((cb) => cb()),
  }
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  }
}));

// Mock schema to avoid actual DB dependency/imports if possible, 
// but sticking to real imports with mocks is fine if schema is just an object.
// We mocked '../../db' so we need to ensure chainable methods work.

describe('storageService settings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Setup chianing for db.select().from().all()
        const mockAll = vi.fn();
        const mockFrom = vi.fn().mockReturnValue({ all: mockAll });
        vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
        
        // Setup chaining for db.insert().values().onConflictDoUpdate().run()
        const mockRun = vi.fn();
        const mockOnConflict = vi.fn().mockReturnValue({ run: mockRun });
        const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
        vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);
    });

    describe('getSettings', () => {
        it('should retrieve and parse settings correctly', () => {
            const mockSettings = [
                { key: 'stringKey', value: 'stringValue' }, // Non-JSON string, will fail parsing and be used as is
                { key: 'jsonKey', value: '{"foo":"bar"}' },  // JSON string
                { key: 'boolKey', value: 'true' }           // JSON boolean
            ];

            // Re-setup mock for this test
            const mockAll = vi.fn().mockReturnValue(mockSettings);
            const mockFrom = vi.fn().mockReturnValue({ all: mockAll });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const result = getSettings();

            expect(result).toEqual({
                stringKey: 'stringValue', // JSON.parse('stringValue') throws, catches, returns 'stringValue'
                jsonKey: { foo: 'bar' },
                boolKey: true
            });
        });

        it('should return empty object and log error on failure', () => {
             vi.mocked(db.select).mockImplementation(() => {
                 throw new Error('DB Error');
             });

             const result = getSettings();

             expect(result).toEqual({});
             expect(logger.error).toHaveBeenCalledWith('Error getting settings', expect.any(Error));
        });
    });

    describe('saveSettings', () => {
        it('should save settings in a transaction', () => {
            const newSettings = {
                key1: 'value1',
                key2: { nested: true }
            };

            saveSettings(newSettings);

            expect(db.transaction).toHaveBeenCalled();
            expect(db.insert).toHaveBeenCalledTimes(2);
            
            // Check first insert
            // Note: Order of keys in Object.entries is roughly insertion order but not guaranteed.
            // Using flexible matching.
            
            // Check keys logic
            // We can't easily spy on which call was which without inspection, 
            // but we expect insert to be called for each key.
        });

        it('should skip undefined values', () => {
            saveSettings({ key1: undefined });
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('should throw DatabaseError on failure', () => {
            vi.mocked(db.transaction).mockImplementation(() => {
                throw new Error('Transaction Failed');
            });

            expect(() => saveSettings({ key: 'value' })).toThrow(DatabaseError);
            expect(logger.error).toHaveBeenCalled();
        });
    });
});
