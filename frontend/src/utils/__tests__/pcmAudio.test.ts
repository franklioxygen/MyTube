import { describe, expect, it } from 'vitest';
import { base64ToInt16, int16ToBase64, int16ToFloat32 } from '../pcmAudio';

describe('pcmAudio', () => {
  it('round-trips Int16 PCM through base64', () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 12345, -9999]);
    const encoded = int16ToBase64(samples);
    expect(typeof encoded).toBe('string');
    const decoded = base64ToInt16(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(samples));
  });

  it('converts Int16 to Float32 in [-1, 1]', () => {
    const float = int16ToFloat32(new Int16Array([0, 32767, -32768]));
    expect(float[0]).toBe(0);
    expect(float[1]).toBeCloseTo(1, 4);
    expect(float[2]).toBeCloseTo(-1, 4);
  });

  it('handles a large buffer without stack overflow', () => {
    const big = new Int16Array(200000);
    for (let i = 0; i < big.length; i++) big[i] = (i % 65536) - 32768;
    const encoded = int16ToBase64(big);
    expect(base64ToInt16(encoded).length).toBe(big.length);
  });
});
