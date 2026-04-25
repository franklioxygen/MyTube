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

const RSS_TEXT_LABELS = new Map<string, RssTextLabels>([
  ["ar", ar],
  ["de", de],
  ["en", en],
  ["es", es],
  ["fr", fr],
  ["ja", ja],
  ["ko", ko],
  ["pt", pt],
  ["ru", ru],
  ["zh", zh],
]);

export function getRssTextLabels(language: string): RssTextLabels {
  const baseLanguage = language.toLowerCase().split("-")[0] ?? "en";
  return RSS_TEXT_LABELS.get(baseLanguage) ?? en;
}

export type { RssTextLabels };
