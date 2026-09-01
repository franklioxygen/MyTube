import { describe, expect, it } from "vitest";
import { ar } from "../ar";
import { de } from "../de";
import { en } from "../en";
import { es } from "../es";
import { fr } from "../fr";
import { ja } from "../ja";
import { ko } from "../ko";
import { pt } from "../pt";
import { ru } from "../ru";
import { zh } from "../zh";

/**
 * Locale modules are plain untyped object literals and only `en` is used to
 * derive TranslationKey. A key missing from a translated locale therefore
 * produces no type error and no runtime failure - it silently falls back to
 * English. This suite is the only thing standing between that and a shipped
 * half-translated feature.
 */

const LOCALES: Record<string, Record<string, unknown>> = {
  zh,
  es,
  de,
  ja,
  fr,
  ko,
  ar,
  pt,
  ru,
};

const englishKeys = Object.keys(en);

describe.each(Object.keys(LOCALES))("locale %s", (name) => {
  const locale = LOCALES[name];

  it("defines every English key", () => {
    const missing = englishKeys.filter((key) => !(key in locale));
    expect(missing).toEqual([]);
  });

  it("defines no key English does not have", () => {
    const extra = Object.keys(locale).filter((key) => !(key in en));
    expect(extra).toEqual([]);
  });

  it("has no empty translations", () => {
    const empty = Object.entries(locale)
      .filter(([, value]) => typeof value === "string" && value.trim() === "")
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("keeps every interpolation placeholder English uses", () => {
    // A dropped {count} or {time} renders a literal brace to the user.
    const mismatched: string[] = [];

    for (const key of englishKeys) {
      const source = (en as Record<string, unknown>)[key];
      const target = locale[key];
      if (typeof source !== "string" || typeof target !== "string") continue;

      // Compare the SET of names, not the multiset. t() interpolates with
      // replaceAll, so a translation may legitimately repeat a placeholder -
      // Spanish, French, Portuguese and Arabic all need {plural} twice in
      // "{count} playlist{plural} {wasWere} already subscribed" for noun and
      // adjective agreement.
      const placeholders = (text: string) =>
        [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

      const expected = placeholders(source);
      if (expected.length === 0) continue;
      if (JSON.stringify(placeholders(target)) !== JSON.stringify(expected)) {
        mismatched.push(key);
      }
    }

    expect(mismatched).toEqual([]);
  });
});

describe("English catalogue", () => {
  it("has no duplicate keys after the Gesture Login block", () => {
    expect(new Set(englishKeys).size).toBe(englishKeys.length);
  });

  it("defines every Gesture Login key the feature references", () => {
    const required = [
      "or",
      "gestureLogin",
      "gestureLoginHelper",
      "gestureLoginSetUpTitle",
      "gestureLoginChange",
      "gestureLoginRemoveTitle",
      "gestureLoginStep",
      "gestureLoginMinimumDots",
      "gestureLoginMismatch",
      "gestureLoginLockedPasswordRecovery",
      "gestureLoginIncorrectAttemptsRemaining",
      "gestureLoginUnavailable",
      "gestureLoginResetRequired",
      "gestureLoginStatusFailed",
      "gestureLoginRetryStatus",
    ];

    expect(required.filter((key) => !(key in en))).toEqual([]);
  });
});
