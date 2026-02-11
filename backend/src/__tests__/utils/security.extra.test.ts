import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildAllowlistedHttpUrl,
  getClientIp,
  isHostnameAllowed,
  isPathWithinDirectories,
  isPathWithinDirectory,
  resolveSafePath,
  resolveSafePathInDirectories,
  sanitizePathSegment,
  validateCloudThumbnailCachePath,
  validateImagePath,
  validatePathWithinDirectories,
  validateRedirectUrl,
  validateUrl,
  validateUrlWithAllowlist,
  validateVideoPath,
} from "../../utils/security";
import {
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";

describe("security extra", () => {
  describe("path guards", () => {
    it("checks whether a path is within one directory", () => {
      expect(isPathWithinDirectory("/base/a/b.mp4", "/base")).toBe(true);
      expect(isPathWithinDirectory("/other/a.mp4", "/base")).toBe(false);
      expect(isPathWithinDirectory("", "/base")).toBe(false);
    });

    it("checks whether a path is within any allowed directory", () => {
      expect(
        isPathWithinDirectories("/a/file.txt", ["/x", "/a", "/z"])
      ).toBe(true);
      expect(isPathWithinDirectories("/a/file.txt", ["/x", "/z"])).toBe(
        false
      );
      expect(isPathWithinDirectories("/a/file.txt", [])).toBe(false);
    });

    it("resolves safe paths and rejects traversal", () => {
      const safe = resolveSafePath(
        path.join(VIDEOS_DIR, "movie.mp4"),
        VIDEOS_DIR
      );
      expect(safe).toBe(path.join(VIDEOS_DIR, "movie.mp4"));

      expect(() => resolveSafePath("../etc/passwd", VIDEOS_DIR)).toThrow(
        "Path traversal detected"
      );
      expect(() => resolveSafePath("", VIDEOS_DIR)).toThrow("Invalid file path");
    });

    it("validates against multiple directories", () => {
      const imageFile = path.join(IMAGES_DIR, "x.jpg");

      expect(
        validatePathWithinDirectories(imageFile, [VIDEOS_DIR, IMAGES_DIR])
      ).toBe(true);
      expect(validatePathWithinDirectories(imageFile, [VIDEOS_DIR])).toBe(false);

      expect(
        resolveSafePathInDirectories(imageFile, [VIDEOS_DIR, IMAGES_DIR])
      ).toBe(imageFile);
      expect(() => resolveSafePathInDirectories(imageFile, [VIDEOS_DIR])).toThrow(
        "outside allowed directories"
      );
    });

    it("sanitizes path segments and validates typed paths", () => {
      expect(sanitizePathSegment(" ../bad\\name/\0 ")).toBe("badname");

      expect(validateVideoPath(path.join(VIDEOS_DIR, "v.mp4"))).toBe(
        path.join(VIDEOS_DIR, "v.mp4")
      );
      expect(validateImagePath(path.join(IMAGES_DIR, "i.jpg"))).toBe(
        path.join(IMAGES_DIR, "i.jpg")
      );
      expect(
        validateCloudThumbnailCachePath(path.join(CLOUD_THUMBNAIL_CACHE_DIR, "c.jpg"))
      ).toBe(path.join(CLOUD_THUMBNAIL_CACHE_DIR, "c.jpg"));

      expect(() => validateVideoPath(path.join(IMAGES_DIR, "i.jpg"))).toThrow();
      expect(() => validateImagePath(path.join(VIDEOS_DIR, "v.mp4"))).toThrow();
    });
  });

  describe("url guards", () => {
    it("validates http/https URLs and blocks private/internal hosts", () => {
      expect(validateUrl("https://example.com/path")).toBe(
        "https://example.com/path"
      );
      expect(() => validateUrl("ftp://example.com")).toThrow("Invalid protocol");
      expect(() => validateUrl("http://127.0.0.1")).toThrow(
        "SSRF protection"
      );
      expect(() => validateUrl("not-url")).toThrow("Invalid URL format");
    });

    it("supports exact/subdomain allow-list checks", () => {
      expect(isHostnameAllowed("www.Example.com", ["example.com"])).toBe(true);
      expect(isHostnameAllowed("api.example.com", ["example.com"])).toBe(true);
      expect(isHostnameAllowed("evil-example.com", ["example.com"])).toBe(
        false
      );
    });

    it("validates URL with allow-list and blocks traversal", () => {
      expect(
        validateUrlWithAllowlist("https://api.example.com/data", ["example.com"])
      ).toBe("https://api.example.com/data");

      expect(() =>
        validateUrlWithAllowlist("https://evil.com/data", ["example.com"])
      ).toThrow("allow-list");

      expect(
        validateUrlWithAllowlist("https://example.com/a/../b", ["example.com"])
      ).toBe("https://example.com/a/../b");
    });

    it("builds allowlisted URL and rejects credentials/ports", () => {
      expect(
        buildAllowlistedHttpUrl("https://EXAMPLE.com/path?q=1", ["example.com"])
      ).toBe("https://example.com/path?q=1");

      expect(() =>
        buildAllowlistedHttpUrl("https://user:pass@example.com/path", [
          "example.com",
        ])
      ).toThrow("credentials");

      expect(() =>
        buildAllowlistedHttpUrl("https://example.com:8443/path", ["example.com"])
      ).toThrow("explicit ports");
    });

    it("validates redirect URLs against a strict origin", () => {
      const allowed = "https://openlist.example.com";
      expect(
        validateRedirectUrl("https://openlist.example.com/file.mp4", allowed)
      ).toBe("https://openlist.example.com/file.mp4");

      expect(() => validateRedirectUrl("//evil.com", allowed)).toThrow(
        "Protocol-relative"
      );
      expect(() => validateRedirectUrl("javascript:alert(1)", allowed)).toThrow(
        "Dangerous protocol"
      );
      expect(() =>
        validateRedirectUrl("https://evil.com/file.mp4", allowed)
      ).toThrow("origin mismatch");
    });
  });

  describe("client IP extraction", () => {
    it("uses socket IP by default and strips ::ffff prefix", () => {
      const ip = getClientIp({
        socket: { remoteAddress: "::ffff:203.0.113.8" },
        headers: {},
        app: { get: () => false },
      });
      expect(ip).toBe("203.0.113.8");
    });

    it("uses X-Forwarded-For when behind trusted proxy with private socket IP", () => {
      const ip = getClientIp({
        socket: { remoteAddress: "192.168.1.2" },
        headers: { "x-forwarded-for": "198.51.100.3, 203.0.113.9" },
        app: { get: () => 1 },
      });
      expect(ip).toBe("203.0.113.9");
    });

    it("ignores spoofed X-Forwarded-For when socket IP is public", () => {
      const ip = getClientIp({
        socket: { remoteAddress: "203.0.113.20" },
        headers: { "x-forwarded-for": "198.51.100.3" },
        app: { get: () => 1 },
      });
      expect(ip).toBe("203.0.113.20");
    });

    it("falls back to req.ip and finally unknown", () => {
      const fromReqIp = getClientIp({
        socket: { remoteAddress: "bad-ip" },
        headers: {},
        ip: "198.51.100.10",
        app: { get: () => true },
      });
      expect(fromReqIp).toBe("198.51.100.10");

      const unknown = getClientIp({
        socket: {},
        headers: {},
        app: { get: () => false },
      });
      expect(unknown).toBe("unknown");
    });
  });
});
