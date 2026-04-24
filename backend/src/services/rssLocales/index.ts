import ar from "./ar";
import de from "./de";
import en from "./en";
import es from "./es";
import fr from "./fr";
import ja from "./ja";
import ko from "./ko";
import pt from "./pt";
import ru from "./ru";
import zh from "./zh";
import type { RssTextLabels } from "./types";

const RSS_TEXT_LABELS: Record<string, RssTextLabels> = {
  ar,
  de,
  en,
  es,
  fr,
  ja,
  ko,
  pt,
  ru,
  zh,
};

export function getRssTextLabels(language: string): RssTextLabels {
  const baseLanguage = language.toLowerCase().split("-")[0] ?? "en";
  return RSS_TEXT_LABELS[baseLanguage] ?? en;
}

export type { RssTextLabels };
