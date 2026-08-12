import { describe, expect, it } from 'vitest';
import { buildSafeMissAvNavigationTarget } from '../../../services/downloaders/missav/navigation';

describe('buildSafeMissAvNavigationTarget', () => {
  it('keeps a route prefix plus language segment', () => {
    expect(
      buildSafeMissAvNavigationTarget('https://missav.ai/dm9/cn/tysf-026-uncensored-leak').url,
    ).toBe('https://missav.ai/dm9/cn/tysf-026-uncensored-leak');
    expect(
      buildSafeMissAvNavigationTarget('https://missav.ai/dm30/en/juq-819-uncensored-leak').url,
    ).toBe('https://missav.ai/dm30/en/juq-819-uncensored-leak');
  });

  it('keeps language segments that are not part of any hardcoded list', () => {
    for (const language of ['cn', 'zh', 'ja', 'ko', 'th', 'fil', 'pt-br']) {
      expect(
        buildSafeMissAvNavigationTarget(`https://missav.ws/${language}/san-467`).url,
      ).toBe(`https://missav.ws/${language}/san-467`);
    }
  });

  it('keeps routed /v/ paths on every mirror, not just 123av-style hosts', () => {
    expect(buildSafeMissAvNavigationTarget('https://123av.com/en/v/fc2-ppv-2683017').url).toBe(
      'https://123av.com/en/v/fc2-ppv-2683017',
    );
    expect(buildSafeMissAvNavigationTarget('https://javxx.com/en/v/fc2-ppv-2683017').url).toBe(
      'https://javxx.com/en/v/fc2-ppv-2683017',
    );
    expect(buildSafeMissAvNavigationTarget('https://njavtv.com/cn/v/fc2-ppv-2683017').url).toBe(
      'https://njavtv.com/cn/v/fc2-ppv-2683017',
    );
    expect(buildSafeMissAvNavigationTarget('https://missav.ai/v/fc2-ppv-1627274').url).toBe(
      'https://missav.ai/v/fc2-ppv-1627274',
    );
  });

  it('accepts bare and single-prefix video paths', () => {
    expect(buildSafeMissAvNavigationTarget('https://missav.ai/fc2-ppv-1627274').url).toBe(
      'https://missav.ai/fc2-ppv-1627274',
    );
    expect(buildSafeMissAvNavigationTarget('https://missav.ai/en/fc2-ppv-1627274').url).toBe(
      'https://missav.ai/en/fc2-ppv-1627274',
    );
  });

  it('re-pins subdomains and lowercases route segments onto the allowlisted origin', () => {
    const target = buildSafeMissAvNavigationTarget('https://www.missav.ai/DM9/CN/tysf-026');
    expect(target.origin).toBe('https://missav.ai');
    expect(target.url).toBe('https://missav.ai/dm9/cn/tysf-026');
  });

  it('drops query strings and fragments', () => {
    expect(
      buildSafeMissAvNavigationTarget('https://missav.ai/dm9/cn/tysf-026?next=//evil.test#x').url,
    ).toBe('https://missav.ai/dm9/cn/tysf-026');
  });

  it('rejects paths that are deeper than a video page', () => {
    expect(() =>
      buildSafeMissAvNavigationTarget('https://missav.ai/a/dm9/cn/tysf-026'),
    ).toThrow('Invalid MissAV video path');
  });

  it('rejects unexpected characters in route segments', () => {
    expect(() => buildSafeMissAvNavigationTarget('https://missav.ai/dm9%2F/tysf-026')).toThrow(
      'Invalid MissAV route segment',
    );
  });

  it('collapses traversal segments instead of following them', () => {
    // The URL parser resolves "..", so the rebuilt path can never climb out.
    expect(buildSafeMissAvNavigationTarget('https://missav.ai/dm9/../tysf-026').url).toBe(
      'https://missav.ai/tysf-026',
    );
  });

  it('rejects foreign hosts, credentials and ports', () => {
    expect(() => buildSafeMissAvNavigationTarget('https://evil.test/dm9/cn/tysf-026')).toThrow(
      'Hostname evil.test is not allowed',
    );
    expect(() =>
      buildSafeMissAvNavigationTarget('https://user:pass@missav.ai/dm9/cn/tysf-026'),
    ).toThrow('credentials or explicit ports');
    expect(() => buildSafeMissAvNavigationTarget('https://missav.ai:8080/dm9/cn/tysf-026')).toThrow(
      'credentials or explicit ports',
    );
    expect(() => buildSafeMissAvNavigationTarget('file:///etc/passwd')).toThrow(
      'Unsupported protocol',
    );
  });

  it('rejects an empty or malformed video id', () => {
    expect(() => buildSafeMissAvNavigationTarget('https://missav.ai/')).toThrow(
      'Invalid MissAV video path',
    );
    expect(() => buildSafeMissAvNavigationTarget('https://missav.ai/dm9/cn/tysf 026')).toThrow(
      'Invalid MissAV video path',
    );
  });
});
