import { afterEach, describe, expect, it } from "vitest";
import { computePreloadStrategy } from "../preloadStrategy";

const UA = {
    safariMac:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15",
    firefoxMac:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
    safariIphone:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    firefoxAndroid:
        "Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0",
};

describe("computePreloadStrategy", () => {
    const originalUserAgent = navigator.userAgent;
    const originalMaxTouchPoints = navigator.maxTouchPoints;

    const mockUserAgent = (userAgent: string) => {
        Object.defineProperty(navigator, "userAgent", {
            value: userAgent,
            writable: true,
            configurable: true,
        });
    };

    const mockMaxTouchPoints = (value: number) => {
        Object.defineProperty(navigator, "maxTouchPoints", {
            value,
            writable: true,
            configurable: true,
        });
    };

    const mockConnection = (connection: {
        effectiveType?: string;
        saveData?: boolean;
    }) => {
        Object.defineProperty(navigator, "connection", {
            value: connection,
            writable: true,
            configurable: true,
        });
    };

    afterEach(() => {
        mockUserAgent(originalUserAgent);
        mockMaxTouchPoints(originalMaxTouchPoints);
        delete (navigator as { connection?: unknown }).connection;
    });

    describe("with the Network Information API", () => {
        it("returns 'none' when Save-Data is on", () => {
            mockConnection({ effectiveType: "4g", saveData: true });
            expect(computePreloadStrategy()).toBe("none");
        });

        it("returns 'auto' on a fast connection", () => {
            mockConnection({ effectiveType: "4g", saveData: false });
            expect(computePreloadStrategy()).toBe("auto");
        });

        it("returns 'metadata' on a slow connection", () => {
            mockConnection({ effectiveType: "3g", saveData: false });
            expect(computePreloadStrategy()).toBe("metadata");
        });
    });

    describe("without the Network Information API", () => {
        it("returns 'auto' for desktop Safari WebM (linear WebM loader needs read-ahead)", () => {
            mockUserAgent(UA.safariMac);
            mockMaxTouchPoints(0);
            expect(computePreloadStrategy({ src: "/videos/clip.webm" })).toBe("auto");
        });

        it("returns 'metadata' for desktop Safari MP4", () => {
            mockUserAgent(UA.safariMac);
            mockMaxTouchPoints(0);
            expect(computePreloadStrategy({ src: "/videos/clip.mp4" })).toBe("metadata");
        });

        it("returns 'auto' for desktop Safari WebM when the playback URL has no extension", () => {
            mockUserAgent(UA.safariMac);
            mockMaxTouchPoints(0);
            expect(
                computePreloadStrategy({
                    src: "/api/mount-video/v1",
                    mediaPath: "mount:/library/videos/clip.webm",
                })
            ).toBe("auto");
        });

        it("returns 'metadata' for desktop Safari when neither URL nor media path identifies WebM", () => {
            mockUserAgent(UA.safariMac);
            mockMaxTouchPoints(0);
            expect(computePreloadStrategy({ src: "/api/mount-video/v1" })).toBe("metadata");
        });

        it("returns 'metadata' for desktop Firefox (range-seeks fine)", () => {
            mockUserAgent(UA.firefoxMac);
            mockMaxTouchPoints(0);
            expect(computePreloadStrategy()).toBe("metadata");
        });

        it("returns 'metadata' for iPhone Safari", () => {
            mockUserAgent(UA.safariIphone);
            expect(computePreloadStrategy()).toBe("metadata");
        });

        it("returns 'metadata' for iPadOS Safari despite its desktop Mac UA", () => {
            mockUserAgent(UA.safariMac);
            mockMaxTouchPoints(5);
            expect(computePreloadStrategy()).toBe("metadata");
        });

        it("returns 'metadata' for Android Firefox", () => {
            mockUserAgent(UA.firefoxAndroid);
            expect(computePreloadStrategy()).toBe("metadata");
        });
    });
});
