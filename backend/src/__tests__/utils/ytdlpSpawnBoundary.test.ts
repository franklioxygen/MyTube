import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(__dirname, "../../");

/**
 * Only these modules may create a yt-dlp child process. `launcher.ts` owns
 * execution (`spawnYtDlp`), `process.ts` owns bounded probe runs, and
 * `versionProbe.ts` owns the bootstrap `--version`/`--help` probes that run
 * before any release exists. `runtime.ts` spawns Deno, which is not yt-dlp and
 * is never updated at runtime.
 */
const SPAWN_OWNERS: Record<string, number> = {
  "utils/ytdlp/release/launcher.ts": 1,
  // spawn for the probe itself, plus a spawnSync("taskkill") used only on the
  // Windows timeout path to terminate the process tree.
  "utils/ytdlp/release/process.ts": 2,
  "utils/ytdlp/versionProbe.ts": 2,
  "utils/ytdlp/runtime.ts": 1,
};

/** Every module that builds yt-dlp arguments or runs yt-dlp work. */
const YT_DLP_MODULES = [
  ...listTsFiles("utils/ytdlp"),
  "services/downloaders/MissAVDownloader.ts",
];

function listTsFiles(relativeDir: string): string[] {
  const absoluteDir = path.join(SRC_ROOT, relativeDir);
  return fs
    .readdirSync(absoluteDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) =>
      // Keys in SPAWN_OWNERS are POSIX-style, so normalize Windows separators.
      path
        .relative(SRC_ROOT, path.join(entry.parentPath ?? absoluteDir, entry.name))
        .split(path.sep)
        .join("/")
    );
}

function parse(relativePath: string): ts.SourceFile {
  const absolutePath = path.join(SRC_ROOT, relativePath);
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
}

/**
 * Count call expressions that create a process directly, whatever name the
 * import was bound to. Counting (rather than listing files) is the point: a
 * second direct spawn added to an already-allowed module changes the count and
 * fails the test.
 */
function countDirectProcessCreations(source: ts.SourceFile): number {
  const childProcessBindings = new Set<string>();
  const creators = new Set(["spawn", "spawnSync", "exec", "execFile", "fork"]);

  const collectImports = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "child_process"
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (creators.has(imported)) {
            childProcessBindings.add(element.name.text);
          }
        }
      }
      if (bindings && ts.isNamespaceImport(bindings)) {
        childProcessBindings.add(bindings.name.text);
      }
    }
    ts.forEachChild(node, collectImports);
  };
  collectImports(source);

  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && childProcessBindings.has(callee.text)) {
        count += 1;
      }
      // `cp.spawn(...)`, `(await import("child_process")).spawn(...)`
      if (
        ts.isPropertyAccessExpression(callee) &&
        creators.has(callee.name.text) &&
        ts.isIdentifier(callee.expression) &&
        childProcessBindings.has(callee.expression.text)
      ) {
        count += 1;
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "child_process"
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

describe("yt-dlp spawn boundary", () => {
  it("creates yt-dlp processes only in the release launcher and bootstrap probes", () => {
    const offenders = YT_DLP_MODULES.filter(
      (relativePath) =>
        countDirectProcessCreations(parse(relativePath)) >
        (SPAWN_OWNERS[relativePath] ?? 0)
    );
    expect(offenders).toEqual([]);
  });

  it("fails when a second direct spawn is added to an already-allowed module", () => {
    // The guarantee the design asks for: the rule counts calls, so growing an
    // existing caller is caught, not just adding a new file.
    const launcher = parse("utils/ytdlp/release/launcher.ts");
    expect(countDirectProcessCreations(launcher)).toBe(
      SPAWN_OWNERS["utils/ytdlp/release/launcher.ts"]
    );

    const withExtraSpawn = ts.createSourceFile(
      "launcher.ts",
      `${launcher.getFullText()}\nfunction sneaky() { return spawn("yt-dlp", []); }\n`,
      ts.ScriptTarget.Latest,
      true
    );
    expect(countDirectProcessCreations(withExtraSpawn)).toBeGreaterThan(
      SPAWN_OWNERS["utils/ytdlp/release/launcher.ts"]
    );
  });

  it("routes application callers through the release API", () => {
    for (const relativePath of [
      "utils/ytdlp/execute.ts",
      "services/downloaders/MissAVDownloader.ts",
    ]) {
      const source = fs.readFileSync(path.join(SRC_ROOT, relativePath), "utf8");
      expect(source).toMatch(/spawnYtDlp/);
      expect(source).toMatch(/withYtDlpRelease/);
    }
  });

  it("keeps release-scoped probes on an explicit release argument", () => {
    const runtime = fs.readFileSync(
      path.join(SRC_ROOT, "utils/ytdlp/runtime.ts"),
      "utf8"
    );
    for (const probe of [
      "isYtDlpImpersonateAvailable",
      "getYouTubeJsRuntimeFlag",
      "ytDlpSupportsRemoteComponents",
    ]) {
      expect(runtime).toMatch(
        new RegExp(`export async function ${probe}\\(\\s*release: YtDlpRelease`)
      );
    }
  });
});
