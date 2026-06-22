import { describe, expect, it } from 'vitest';
import { downmixToMono, floatTo16BitPCM } from '../pcmConversion';

describe('pcmConversion', () => {
  describe('downmixToMono', () => {
    it('returns the single channel unchanged', () => {
      const ch = new Float32Array([0.1, 0.2, 0.3]);
      expect(downmixToMono([ch])).toBe(ch);
    });

    it('averages multiple channels', () => {
      const l = new Float32Array([1, 0, -1]);
      const r = new Float32Array([0, 0, 1]);
      const mono = downmixToMono([l, r]);
      expect(Array.from(mono)).toEqual([0.5, 0, 0]);
    });

    it('handles empty input', () => {
      expect(downmixToMono([]).length).toBe(0);
    });
  });

  describe('floatTo16BitPCM', () => {
    it('maps the full range and clamps out-of-range values', () => {
      const out = floatTo16BitPCM(new Float32Array([0, 1, -1, 2, -2]));
      expect(out[0]).toBe(0);
      expect(out[1]).toBe(32767);
      expect(out[2]).toBe(-32768);
      // Clamped
      expect(out[3]).toBe(32767);
      expect(out[4]).toBe(-32768);
    });

    it('scales mid values', () => {
      const out = floatTo16BitPCM(new Float32Array([0.5, -0.5]));
      expect(out[0]).toBeCloseTo(16384, 0);
      expect(out[1]).toBeCloseTo(-16384, 0);
    });
  });
});
