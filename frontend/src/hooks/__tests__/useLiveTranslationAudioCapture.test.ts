import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAudioCaptureSupported } from '../useLiveTranslationAudioCapture';

class FakeAudioContextWithMediaElementSource {
  createMediaElementSource() {
    return {};
  }
}

class FakeAudioContextWithoutMediaElementSource {}

class FakeAudioWorkletNode {}

describe('isAudioCaptureSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checks support for the media-element source API actually used by capture', () => {
    vi.stubGlobal(
      'AudioContext',
      FakeAudioContextWithMediaElementSource as unknown as typeof AudioContext,
    );
    vi.stubGlobal(
      'AudioWorkletNode',
      FakeAudioWorkletNode as unknown as typeof AudioWorkletNode,
    );
    // The implementation does not use MediaStreamAudioSourceNode; browsers that
    // support MediaElementAudioSourceNode should not be rejected because this is absent.
    vi.stubGlobal('MediaStreamAudioSourceNode', undefined);

    expect(isAudioCaptureSupported()).toBe(true);
  });

  it('returns false when media-element source capture is unavailable', () => {
    vi.stubGlobal(
      'AudioContext',
      FakeAudioContextWithoutMediaElementSource as unknown as typeof AudioContext,
    );
    vi.stubGlobal(
      'AudioWorkletNode',
      FakeAudioWorkletNode as unknown as typeof AudioWorkletNode,
    );

    expect(isAudioCaptureSupported()).toBe(false);
  });
});
