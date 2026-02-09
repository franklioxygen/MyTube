import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db';
import { invalidateSettingsCache, saveSettings } from '../settings';

// Mock DB
vi.mock('../../../db', () => ({
  db: {
    insert: vi.fn(),
    transaction: vi.fn((cb) => cb()),
  }
}));

describe('settings mass assignment protection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invalidateSettingsCache();
        
        // Setup chaining for db.insert().values().onConflictDoUpdate().run()
        const mockRun = vi.fn();
        const mockOnConflict = vi.fn().mockReturnValue({ run: mockRun });
        const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
        vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);
    });

    it('should ignore arbitrary fields not in the whitelist', () => {
        const payload = {
            loginEnabled: true, // Whitelisted
            arbitraryField: 'injected' // Not whitelisted
        };

        saveSettings(payload);

        expect(db.insert).toHaveBeenCalledTimes(1);
        
        // Verify only the valid key was inserted
        const insertCallArgs = vi.mocked(db.insert).mock.calls[0][0];
        const mockedValuesFn = vi.mocked(db.insert).mock.results[0].value.values;
        
        expect(mockedValuesFn).toHaveBeenCalledWith(
            expect.objectContaining({ 
                key: 'loginEnabled',
                value: 'true'
            })
        );
        
        // Ensure arbitraryField was NEVER processed
        // Since insert was called 1 time, and we verified it was for loginEnabled, 
        // it means arbitraryField was skipped.
    });

    it('should allow all whitelisted fields', () => {
        // Test a few critical fields
        const payload = {
            password: 'hashedpassword',
            allowedHosts: 'localhost',
            ytDlpConfig: 'config'
        };

        saveSettings(payload);

        expect(db.insert).toHaveBeenCalledTimes(3);
    });
});
