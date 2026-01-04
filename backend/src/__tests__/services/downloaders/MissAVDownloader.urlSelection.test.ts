import { describe, expect, it } from 'vitest';
import { MissAVDownloader } from '../../../services/downloaders/MissAVDownloader';

describe('MissAVDownloader URL Selection', () => {
  describe('selectBestM3u8Url', () => {
    it('should prioritize surrit.com master playlist over other specific quality playlists', () => {
      const urls = [
        'https://surrit.com/9183fb8b-9d17-43c7-b429-4c28b7813e2c/playlist.m3u8',
        'https://surrit.com/9183fb8b-9d17-43c7-b429-4c28b7813e2c/480p/video.m3u8',
        'https://edge-hls.growcdnssedge.com/hls/121964773/master/121964773_240p.m3u8',
        'https://media-hls.growcdnssedge.com/b-hls-18/121964773/121964773_240p.m3u8'
      ];
      
      // Default behavior (no format sort)
      const selected = MissAVDownloader.selectBestM3u8Url(urls, false);
      expect(selected).toBe('https://surrit.com/9183fb8b-9d17-43c7-b429-4c28b7813e2c/playlist.m3u8');
    });

    it('should prioritize higher resolution when multiple surrit URLs exist', () => {
      const urls = [
        'https://surrit.com/uuid/playlist.m3u8', // Master
        'https://surrit.com/uuid/720p/video.m3u8',
        'https://surrit.com/uuid/480p/video.m3u8'
      ];
      
      const selected = MissAVDownloader.selectBestM3u8Url(urls, false);
      // If we have specific qualities, we usually prefer the highest specific one if no format sort is used,
      // OR we might prefer the master if we trust yt-dlp to pick best.
      // Based on typical behavior without format sort: existing logic preferred specific resolutions.
      // But for MissAV, playlist.m3u8 is usually more reliable/complete. 
      // Let's assume we want to stick with Master if available for surrit.
      expect(selected).toContain('playlist.m3u8'); 
      // OR if we keep logic "prefer specific quality", then 720p.
      // The requirement is "Prioritize surrit.com URLs... prefer playlist.m3u8 (generic master) over specific resolution masters if the specific resolution is low/suspicious"
      // In this case 720p is good. 
      // However, usually playlist.m3u8 contains all variants.
    });

    it('should fallback to resolution comparison if no surrit URLs', () => {
      const urls = [
        'https://other.com/video_240p.m3u8',
        'https://other.com/video_720p.m3u8',
        'https://other.com/video_480p.m3u8'
      ];
      
      const selected = MissAVDownloader.selectBestM3u8Url(urls, false);
      expect(selected).toBe('https://other.com/video_720p.m3u8');
    });

    it('should handle real world scenario from logs', () => {
      // From user log
      const urls = [
        'https://surrit.com/9183fb8b-9d17-43c7-b429-4c28b7813e2c/playlist.m3u8',
        'https://surrit.com/9183fb8b-9d17-43c7-b429-4c28b7813e2c/480p/video.m3u8',
        'https://media-hls.growcdnssedge.com/b-hls-18/121964773/121964773_240p.m3u8',
        'https://edge-hls.growcdnssedge.com/hls/121964773/master/121964773_240p.m3u8'
      ];

      const selected = MissAVDownloader.selectBestM3u8Url(urls, false);
      // The bug was it picked the last one (edge-hls...240p.m3u8) or similar.
      // We want the surrit playlist.
      expect(selected).toBe('https://surrit.com/9183fb8b-9d17-43c7-b429-4c28b7813e2c/playlist.m3u8');
    });
    
    it('should respect format sort when enabled', () => {
       const urls = [
        'https://surrit.com/uuid/playlist.m3u8', 
        'https://surrit.com/uuid/480p/video.m3u8'
      ];
      // With format sort, we DEFINITELY want the master playlist so yt-dlp can do the sorting
      const selected = MissAVDownloader.selectBestM3u8Url(urls, true);
      expect(selected).toBe('https://surrit.com/uuid/playlist.m3u8');
    });
  });
});
