import { describe, expect, it } from 'vitest';
import { isMissAVUrl } from '../missav';

describe('isMissAVUrl', () => {
  it.each([
    'https://missav.com/en/v/example',
    'https://www.missav.ai/example',
    'https://123av.ws/en/v/example',
    'https://javxx.com/en/v/example',
    'https://njavtv.com/example',
  ])('recognizes %s', (url) => {
    expect(isMissAVUrl(url)).toBe(true);
  });

  it.each([
    'https://youtube.com/watch?v=abc',
    'https://www.twitch.tv/videos/123',
    'https://www.bilibili.com/video/BV1xx',
    'not a url',
  ])('does not classify %s as MissAV', (url) => {
    expect(isMissAVUrl(url)).toBe(false);
  });
});
