import { describe, expect, it } from 'vitest';
import {
  getMediaCrossOriginAttr,
  isCaptureSupportedForSrc,
  isCrossOriginMediaSrc,
} from '../mediaOrigin';

describe('mediaOrigin', () => {
  const sameOrigin = `${window.location.origin}/videos/clip.mp4`;
  const crossOrigin = 'https://cdn.example.com/clip.mp4';

  describe('isCrossOriginMediaSrc', () => {
    it('treats empty/relative/same-origin as same-origin', () => {
      expect(isCrossOriginMediaSrc(null)).toBe(false);
      expect(isCrossOriginMediaSrc('')).toBe(false);
      expect(isCrossOriginMediaSrc('/videos/clip.mp4')).toBe(false);
      expect(isCrossOriginMediaSrc(sameOrigin)).toBe(false);
    });

    it('detects cross-origin absolute URLs', () => {
      expect(isCrossOriginMediaSrc(crossOrigin)).toBe(true);
    });
  });

  describe('getMediaCrossOriginAttr', () => {
    it('returns anonymous only for cross-origin', () => {
      expect(getMediaCrossOriginAttr(crossOrigin)).toBe('anonymous');
      expect(getMediaCrossOriginAttr(sameOrigin)).toBeUndefined();
      expect(getMediaCrossOriginAttr('/videos/clip.mp4')).toBeUndefined();
    });
  });

  describe('isCaptureSupportedForSrc', () => {
    it('supports same-origin and rejects cross-origin / empty', () => {
      expect(isCaptureSupportedForSrc(sameOrigin)).toBe(true);
      expect(isCaptureSupportedForSrc('/videos/clip.mp4')).toBe(true);
      expect(isCaptureSupportedForSrc(crossOrigin)).toBe(false);
      expect(isCaptureSupportedForSrc(null)).toBe(false);
    });
  });
});
