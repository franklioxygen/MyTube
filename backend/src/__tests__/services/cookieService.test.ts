
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cookieService from '../../services/cookieService';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('../../utils/logger');

describe('cookieService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('checkCookies', () => {
        it('should return true if file exists', () => {
            (fs.existsSync as any).mockReturnValue(true);
            expect(cookieService.checkCookies()).toEqual({ exists: true });
        });

        it('should return false if file does not exist', () => {
            (fs.existsSync as any).mockReturnValue(false);
            expect(cookieService.checkCookies()).toEqual({ exists: false });
        });
    });

    describe('uploadCookies', () => {
        it('should write and move uploaded buffer to destination', () => {
            cookieService.uploadCookies(Buffer.from('cookie-data'));
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('cookies.txt.tmp'),
                expect.any(Buffer)
            );
            expect(fs.moveSync).toHaveBeenCalledWith(
                expect.stringContaining('cookies.txt.tmp'),
                expect.stringContaining('cookies.txt'),
                { overwrite: true }
            );
        });

        it('should cleanup temporary file on error', () => {
            (fs.moveSync as any).mockImplementation(() => { throw new Error('Move failed'); });
            (fs.existsSync as any).mockReturnValue(true);

            expect(() => cookieService.uploadCookies(Buffer.from('cookie-data'))).toThrow('Move failed');
            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('cookies.txt.tmp'));
        });
    });

    describe('deleteCookies', () => {
        it('should delete file if exists', () => {
            (fs.existsSync as any).mockReturnValue(true);
            cookieService.deleteCookies();
            expect(fs.unlinkSync).toHaveBeenCalled();
        });

        it('should throw if file does not exist', () => {
            (fs.existsSync as any).mockReturnValue(false);
            expect(() => cookieService.deleteCookies()).toThrow('Cookies file not found');
        });
    });
});
