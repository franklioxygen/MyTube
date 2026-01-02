import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDate,
  formatDuration,
  formatRelativeDownloadTime,
  formatSize,
  parseDuration,
} from "../formatUtils";

describe("formatUtils", () => {
  describe("parseDuration", () => {
    it("should return 0 for undefined", () => {
      expect(parseDuration(undefined)).toBe(0);
    });

    it("should return number as-is", () => {
      expect(parseDuration(100)).toBe(100);
      expect(parseDuration(0)).toBe(0);
    });

    it("should parse HH:MM:SS format", () => {
      expect(parseDuration("1:30:45")).toBe(5445); // 1*3600 + 30*60 + 45 = 3600 + 1800 + 45
      expect(parseDuration("0:5:30")).toBe(330); // 0*3600 + 5*60 + 30 = 0 + 300 + 30
      expect(parseDuration("2:0:0")).toBe(7200); // 2*3600 + 0*60 + 0 = 7200
    });

    it("should parse MM:SS format", () => {
      expect(parseDuration("5:30")).toBe(330); // 5*60 + 30
      expect(parseDuration("10:15")).toBe(615); // 10*60 + 15
      expect(parseDuration("0:45")).toBe(45);
    });

    it("should parse numeric string", () => {
      expect(parseDuration("100")).toBe(100);
      expect(parseDuration("0")).toBe(0);
    });

    it("should return 0 for invalid string", () => {
      expect(parseDuration("invalid")).toBe(0);
      // 'abc:def' will be parsed as NaN for each part, but the function
      // will try parseInt on the whole string which also returns NaN -> 0
      expect(parseDuration("abc:def")).toBe(0);
      expect(parseDuration("not-a-number")).toBe(0);
    });
  });

  describe("formatDuration", () => {
    it("should return 00:00 for undefined", () => {
      expect(formatDuration(undefined)).toBe("00:00");
    });

    it("should return formatted string as-is if already formatted", () => {
      expect(formatDuration("1:30:45")).toBe("1:30:45");
      expect(formatDuration("5:30")).toBe("5:30");
    });

    it("should format seconds to MM:SS", () => {
      expect(formatDuration(65)).toBe("1:05"); // 1 minute 5 seconds
      expect(formatDuration(125)).toBe("2:05"); // 2 minutes 5 seconds
      expect(formatDuration(45)).toBe("0:45"); // 45 seconds
      expect(formatDuration(0)).toBe("00:00");
    });

    it("should format seconds to H:MM:SS for hours", () => {
      expect(formatDuration(3665)).toBe("1:01:05"); // 1 hour 1 minute 5 seconds
      expect(formatDuration(3600)).toBe("1:00:00"); // 1 hour
      expect(formatDuration(7325)).toBe("2:02:05"); // 2 hours 2 minutes 5 seconds
    });

    it("should format numeric string", () => {
      expect(formatDuration("65")).toBe("1:05");
      expect(formatDuration("3665")).toBe("1:01:05");
    });

    it("should return 00:00 for invalid input", () => {
      expect(formatDuration("invalid")).toBe("00:00");
      expect(formatDuration(NaN)).toBe("00:00");
    });
  });

  describe("formatSize", () => {
    it('should return "0 B" for undefined', () => {
      expect(formatSize(undefined)).toBe("0 B");
    });

    it("should format bytes", () => {
      expect(formatSize(0)).toBe("0 B");
      expect(formatSize(500)).toBe("500 B");
      expect(formatSize(1023)).toBe("1023 B");
    });

    it("should format kilobytes", () => {
      expect(formatSize(1024)).toBe("1 KB");
      expect(formatSize(1536)).toBe("1.5 KB");
      expect(formatSize(2048)).toBe("2 KB");
      expect(formatSize(10240)).toBe("10 KB");
    });

    it("should format megabytes", () => {
      expect(formatSize(1048576)).toBe("1 MB"); // 1024 * 1024
      expect(formatSize(1572864)).toBe("1.5 MB");
      expect(formatSize(5242880)).toBe("5 MB");
    });

    it("should format gigabytes", () => {
      expect(formatSize(1073741824)).toBe("1 GB"); // 1024^3
      expect(formatSize(2147483648)).toBe("2 GB");
    });

    it("should format terabytes", () => {
      expect(formatSize(1099511627776)).toBe("1 TB"); // 1024^4
    });

    it("should format numeric string", () => {
      expect(formatSize("1024")).toBe("1 KB");
      expect(formatSize("1048576")).toBe("1 MB");
    });

    it('should return "0 B" for invalid input', () => {
      expect(formatSize("invalid")).toBe("0 B");
      expect(formatSize(NaN)).toBe("0 B");
    });
  });

  describe("formatDate", () => {
    it('should return "Unknown date" for undefined', () => {
      expect(formatDate(undefined)).toBe("Unknown date");
    });

    it('should return "Unknown date" for invalid length', () => {
      expect(formatDate("202301")).toBe("Unknown date");
      expect(formatDate("202301011")).toBe("Unknown date");
      expect(formatDate("2023")).toBe("Unknown date");
    });

    it("should format YYYYMMDD to YYYY-MM-DD", () => {
      expect(formatDate("20230101")).toBe("2023-01-01");
      expect(formatDate("20231225")).toBe("2023-12-25");
      expect(formatDate("20200101")).toBe("2020-01-01");
      expect(formatDate("20230228")).toBe("2023-02-28");
    });

    it("should handle edge cases", () => {
      expect(formatDate("19991231")).toBe("1999-12-31");
      expect(formatDate("20991231")).toBe("2099-12-31");
    });
  });

  describe("formatRelativeDownloadTime", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const mockTranslation = (
      key: string,
      replacements?: Record<string, string | number>
    ) => {
      const translations: Record<string, string> = {
        justNow: "Just now",
        hoursAgo: `${replacements?.hours || 0} hours ago`,
        today: "Today",
        thisWeek: "This week",
        weeksAgo: `${replacements?.weeks || 0} weeks ago`,
        unknownDate: "Unknown date",
      };
      return translations[key] || key;
    };

    it('should return "Just now" for less than 1 hour', () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      const thirtyMinutesAgo = new Date("2023-01-01T11:30:00Z").toISOString();
      expect(
        formatRelativeDownloadTime(thirtyMinutesAgo, undefined, mockTranslation)
      ).toBe("Just now");
    });

    it('should return "X hours ago" for 1-5 hours', () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      const twoHoursAgo = new Date("2023-01-01T10:00:00Z").toISOString();
      expect(
        formatRelativeDownloadTime(twoHoursAgo, undefined, mockTranslation)
      ).toBe("2 hours ago");
    });

    it('should return "Today" for 5-24 hours', () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      const tenHoursAgo = new Date("2023-01-01T02:00:00Z").toISOString();
      expect(
        formatRelativeDownloadTime(tenHoursAgo, undefined, mockTranslation)
      ).toBe("Today");
    });

    it('should return "This week" for 1-7 days', () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      const threeDaysAgo = new Date("2022-12-29T12:00:00Z").toISOString();
      expect(
        formatRelativeDownloadTime(threeDaysAgo, undefined, mockTranslation)
      ).toBe("This week");
    });

    it('should return "X weeks ago" for 1-4 weeks', () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      const twoWeeksAgo = new Date("2022-12-18T12:00:00Z").toISOString();
      expect(
        formatRelativeDownloadTime(twoWeeksAgo, undefined, mockTranslation)
      ).toBe("2 weeks ago");
    });

    it("should return formatted date for > 4 weeks", () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      const sixWeeksAgo = new Date("2022-11-20T12:00:00Z").toISOString();
      const result = formatRelativeDownloadTime(
        sixWeeksAgo,
        "20221120",
        mockTranslation
      );
      expect(result).toBe("2022-11-20");
    });

    it("should use originalDate when provided for > 4 weeks", () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      const sixWeeksAgo = new Date("2022-11-20T12:00:00Z").toISOString();
      expect(
        formatRelativeDownloadTime(sixWeeksAgo, "20221120", mockTranslation)
      ).toBe("2022-11-20");
    });

    it('should fallback to "Unknown date" when no timestamp provided', () => {
      expect(
        formatRelativeDownloadTime(undefined, undefined, mockTranslation)
      ).toBe("Unknown date");
    });

    it("should use originalDate when no timestamp provided", () => {
      expect(
        formatRelativeDownloadTime(undefined, "20230101", mockTranslation)
      ).toBe("2023-01-01");
    });

    it("should fallback to English when no translation function provided", () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      const thirtyMinutesAgo = new Date("2023-01-01T11:30:00Z").toISOString();
      expect(formatRelativeDownloadTime(thirtyMinutesAgo)).toBe("Just now");
    });

    it("should handle invalid date", () => {
      expect(
        formatRelativeDownloadTime("invalid-date", undefined, mockTranslation)
      ).toBe("Unknown date");
    });

    it("should use originalDate when date is invalid", () => {
      expect(
        formatRelativeDownloadTime("invalid-date", "20230101", mockTranslation)
      ).toBe("2023-01-01");
    });

    it("should format date in UTC to avoid timezone issues", () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      // Use a date that could be affected by timezone (midnight UTC)
      const sixWeeksAgo = new Date("2022-11-20T00:00:00Z").toISOString();
      // Should format as 2022-11-20 regardless of system timezone
      const result = formatRelativeDownloadTime(
        sixWeeksAgo,
        undefined,
        mockTranslation
      );
      expect(result).toBe("2022-11-20");
    });

    it("should handle date formatting across timezone boundaries", () => {
      const now = new Date("2023-01-01T12:00:00Z");
      vi.setSystemTime(now);
      // Test with a date near midnight UTC to catch timezone edge cases
      const sixWeeksAgo = new Date("2022-11-20T23:59:59Z").toISOString();
      const result = formatRelativeDownloadTime(
        sixWeeksAgo,
        undefined,
        mockTranslation
      );
      expect(result).toBe("2022-11-20");
    });
  });
});
