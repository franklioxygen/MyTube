import { describe, expect, it } from "vitest";
import { isCloudflareChallengeHtml } from "../../../services/downloaders/missav/navigation";

/**
 * The detection runs only after no m3u8 was captured, so a false positive here
 * does not merely mislabel a page - it reports "Cloudflare blocked us" for a
 * player that simply never started, and sends diagnosis the wrong way.
 */
describe("isCloudflareChallengeHtml", () => {
  describe("pages that are NOT a challenge", () => {
    it("does not fire on the bot-management beacon Cloudflare injects everywhere", () => {
      // This script is served on every page Cloudflare fronts, challenge or
      // not. Matching a bare "challenge-platform" made every normal video page
      // look like an interstitial.
      const html = `
        <html><head><meta property="og:title" content="NHDTC-234"></head>
        <body>
          <div class="player"></div>
          <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
        </body></html>`;

      expect(isCloudflareChallengeHtml(html)).toBe(false);
    });

    it("does not fire on ordinary page copy that mentions verification", () => {
      const html =
        "<html><body><p>Age security verification is required in your region.</p></body></html>";

      expect(isCloudflareChallengeHtml(html)).toBe(false);
    });

    it("does not fire on an empty or contentless page", () => {
      expect(isCloudflareChallengeHtml("")).toBe(false);
      expect(isCloudflareChallengeHtml("<html><body></body></html>")).toBe(false);
    });
  });

  describe("pages that ARE a challenge", () => {
    it("fires on the interstitial title", () => {
      expect(
        isCloudflareChallengeHtml(
          "<html><head><title>Just a moment...</title></head><body></body></html>",
        ),
      ).toBe(true);
    });

    it("fires on the challenge script's config object", () => {
      expect(
        isCloudflareChallengeHtml(
          "<html><body><script>window._cf_chl_opt={cvId:'3'};</script></body></html>",
        ),
      ).toBe(true);
    });

    it("fires on the orchestrate endpoint, which the beacon is not", () => {
      expect(
        isCloudflareChallengeHtml(
          '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>',
        ),
      ).toBe(true);
    });

    it("fires on interstitial markup", () => {
      expect(
        isCloudflareChallengeHtml('<div id="challenge-running"></div>'),
      ).toBe(true);
      expect(isCloudflareChallengeHtml('<form id="challenge-form">')).toBe(true);
    });

    it("fires on a Turnstile widget", () => {
      expect(isCloudflareChallengeHtml('<div class="cf-turnstile"></div>')).toBe(
        true,
      );
    });

    it("fires on the interstitial's verification copy", () => {
      expect(
        isCloudflareChallengeHtml(
          "<body>Performing security verification...</body>",
        ),
      ).toBe(true);
    });
  });
});
