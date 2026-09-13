/**
 * Builds the contents of KEY_LIST.md from en.ts.
 *
 * The list is a derived artifact, and for a long time nothing derived it: by
 * the time this was written the committed file claimed 1091 keys, listed 1225
 * in its tables, and was missing seven whole sections that had been added to
 * en.ts. localeParity.test.ts now asserts the committed file equals what this
 * produces, so the two cannot drift apart again. Regenerate with:
 *
 *   UPDATE_KEY_LIST=1 npx vitest run src/utils/locales/__tests__/localeParity.test.ts
 */

const UNSECTIONED = "Ungrouped";

export interface KeyListSection {
  name: string;
  keys: string[];
}

/**
 * Group `keys` by the `// Comment` heading that precedes each one in the en.ts
 * source text. `keys` must come from `Object.keys(en)` rather than the text, so
 * that nested object keys and lookalike lines inside template strings cannot
 * inflate the list.
 */
export function groupKeysBySection(
  source: string,
  keys: string[]
): KeyListSection[] {
  const lines = source.split("\n");

  const sectionAtLine: string[] = [];
  let current = UNSECTIONED;
  for (const line of lines) {
    const comment = /^ {2}\/\/\s*(.+?)\s*$/.exec(line);
    if (comment) current = comment[1];
    sectionAtLine.push(current);
  }

  // First top-level declaration line for each key.
  const lineOfKey = new Map<string, number>();
  lines.forEach((line, index) => {
    const declaration = /^ {2}("?)([A-Za-z0-9_]+)\1\s*:/.exec(line);
    if (!declaration) return;
    if (!lineOfKey.has(declaration[2])) lineOfKey.set(declaration[2], index);
  });

  const order: string[] = [];
  const bySection = new Map<string, string[]>();
  for (const key of keys) {
    const line = lineOfKey.get(key);
    const section = line === undefined ? UNSECTIONED : sectionAtLine[line];
    if (!bySection.has(section)) {
      bySection.set(section, []);
      order.push(section);
    }
    bySection.get(section)!.push(key);
  }

  return order.map((name) => ({ name, keys: bySection.get(name)! }));
}

export function renderKeyList(
  sections: KeyListSection[],
  totalKeys: number
): string {
  const out: string[] = [
    "# Locale Key List",
    "",
    "Canonical locale key order derived from `frontend/src/utils/locales/en.ts`.",
    "",
    "Generated — do not edit by hand. `localeParity.test.ts` fails when this file",
    "and `en.ts` disagree; regenerate with:",
    "",
    "```",
    "UPDATE_KEY_LIST=1 npx vitest run src/utils/locales/__tests__/localeParity.test.ts",
    "```",
    "",
    "This list is intentionally unnumbered. When new keys are inserted, only the local section order changes.",
    "",
    `Total keys: ${totalKeys}`,
    "",
    "## Summary",
    "",
    "| Section | Keys | First Key | Last Key |",
    "| --- | ---: | --- | --- |",
  ];

  for (const { name, keys } of sections) {
    out.push(
      `| ${name} | ${keys.length} | \`${keys[0]}\` | \`${keys[keys.length - 1]}\` |`
    );
  }
  out.push("");

  for (const { name, keys } of sections) {
    out.push(`### ${name}`, "", "| Key |", "| --- |");
    for (const key of keys) out.push(`| \`${key}\` |`);
    out.push("");
  }

  return out.join("\n");
}
