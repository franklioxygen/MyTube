import { describe, expect, it } from 'vitest';
import { bccToVtt } from '../../utils/bccToVtt';

describe('bccToVtt', () => {
  it('should convert BCC object to VTT format', () => {
    const bcc = {
      font_size: 0.4,
      font_color: '#FFFFFF',
      background_alpha: 0.5,
      background_color: '#000000',
      Stroke: 'none',
      type: 'subtitles',
      lang: 'en',
      version: '1.0',
      body: [
        {
          from: 0,
          to: 2.5,
          location: 2,
          content: 'Hello world',
        },
        {
          from: 2.5,
          to: 5.0,
          location: 2,
          content: 'This is a test',
        },
      ],
    };

    const result = bccToVtt(bcc);

    expect(result).toContain('WEBVTT');
    expect(result).toContain('00:00:00.000 --> 00:00:02.500');
    expect(result).toContain('Hello world');
    expect(result).toContain('00:00:02.500 --> 00:00:05.000');
    expect(result).toContain('This is a test');
  });

  it('should convert BCC string to VTT format', () => {
    const bccString = JSON.stringify({
      font_size: 0.4,
      font_color: '#FFFFFF',
      background_alpha: 0.5,
      background_color: '#000000',
      Stroke: 'none',
      type: 'subtitles',
      lang: 'en',
      version: '1.0',
      body: [
        {
          from: 10.5,
          to: 15.75,
          location: 2,
          content: 'Subtitle text',
        },
      ],
    });

    const result = bccToVtt(bccString);

    expect(result).toContain('WEBVTT');
    expect(result).toContain('00:00:10.500 --> 00:00:15.750');
    expect(result).toContain('Subtitle text');
  });

  it('should handle milliseconds correctly', () => {
    const bcc = {
      font_size: 0.4,
      font_color: '#FFFFFF',
      background_alpha: 0.5,
      background_color: '#000000',
      Stroke: 'none',
      type: 'subtitles',
      lang: 'en',
      version: '1.0',
      body: [
        {
          from: 1.234,
          to: 3.456,
          location: 2,
          content: 'Test',
        },
      ],
    };

    const result = bccToVtt(bcc);

    expect(result).toContain('00:00:01.234 --> 00:00:03.456');
  });

  it('should handle hours correctly', () => {
    const bcc = {
      font_size: 0.4,
      font_color: '#FFFFFF',
      background_alpha: 0.5,
      background_color: '#000000',
      Stroke: 'none',
      type: 'subtitles',
      lang: 'en',
      version: '1.0',
      body: [
        {
          from: 3661.5,
          to: 3665.0,
          location: 2,
          content: 'Hour test',
        },
      ],
    };

    const result = bccToVtt(bcc);

    expect(result).toContain('01:01:01.500 --> 01:01:05.000');
  });

  it('should return empty string for invalid JSON string', () => {
    const invalidJson = 'not valid json';

    const result = bccToVtt(invalidJson);

    expect(result).toBe('');
  });

  it('should return empty string when body is missing', () => {
    const bcc = {
      font_size: 0.4,
      font_color: '#FFFFFF',
      background_alpha: 0.5,
      background_color: '#000000',
      Stroke: 'none',
      type: 'subtitles',
      lang: 'en',
      version: '1.0',
    };

    const result = bccToVtt(bcc as any);

    expect(result).toBe('');
  });

  it('should return empty string when body is not an array', () => {
    const bcc = {
      font_size: 0.4,
      font_color: '#FFFFFF',
      background_alpha: 0.5,
      background_color: '#000000',
      Stroke: 'none',
      type: 'subtitles',
      lang: 'en',
      version: '1.0',
      body: 'not an array',
    };

    const result = bccToVtt(bcc as any);

    expect(result).toBe('');
  });

  it('should handle empty body array', () => {
    const bcc = {
      font_size: 0.4,
      font_color: '#FFFFFF',
      background_alpha: 0.5,
      background_color: '#000000',
      Stroke: 'none',
      type: 'subtitles',
      lang: 'en',
      version: '1.0',
      body: [],
    };

    const result = bccToVtt(bcc);

    expect(result).toBe('WEBVTT\n\n');
  });

  it('should handle multiple subtitles correctly', () => {
    const bcc = {
      font_size: 0.4,
      font_color: '#FFFFFF',
      background_alpha: 0.5,
      background_color: '#000000',
      Stroke: 'none',
      type: 'subtitles',
      lang: 'en',
      version: '1.0',
      body: [
        {
          from: 0,
          to: 1,
          location: 2,
          content: 'First',
        },
        {
          from: 1,
          to: 2,
          location: 2,
          content: 'Second',
        },
        {
          from: 2,
          to: 3,
          location: 2,
          content: 'Third',
        },
      ],
    };

    const result = bccToVtt(bcc);

    const lines = result.split('\n');
    expect(lines[0]).toBe('WEBVTT');
    expect(lines[2]).toBe('00:00:00.000 --> 00:00:01.000');
    expect(lines[3]).toBe('First');
    expect(lines[5]).toBe('00:00:01.000 --> 00:00:02.000');
    expect(lines[6]).toBe('Second');
    expect(lines[8]).toBe('00:00:02.000 --> 00:00:03.000');
    expect(lines[9]).toBe('Third');
  });
});

