import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { groupKeysBySection, renderKeyList } from "../keyListDocument";

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

/**
 * KEY_LIST.md is derived from en.ts, and nothing used to derive it: it drifted
 * to claiming 1091 keys while listing 1225 and omitting seven whole sections.
 * This keeps it honest. When it fails, regenerate rather than hand-editing:
 *
 *   UPDATE_KEY_LIST=1 npx vitest run src/utils/locales/__tests__/localeParity.test.ts
 */
describe("KEY_LIST.md", () => {
  const localesDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const enPath = path.join(localesDir, "en.ts");
  const keyListPath = path.join(localesDir, "KEY_LIST.md");

  it("matches the keys and section order in en.ts", () => {
    const expected = renderKeyList(
      groupKeysBySection(readFileSync(enPath, "utf8"), englishKeys),
      englishKeys.length
    );

    if (process.env.UPDATE_KEY_LIST) {
      writeFileSync(keyListPath, expected);
      return;
    }

    expect(readFileSync(keyListPath, "utf8")).toBe(expected);
  });
});
