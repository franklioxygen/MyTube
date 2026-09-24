#!/usr/bin/env node

// Build a complete, installable archive from the extension source tree.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const packageVersion = require(path.join(rootDir, 'package.json')).version;
const manifest = require(path.join(rootDir, 'manifest.json'));
const archivePath = path.join(rootDir, `mytube-extension-v${packageVersion}.zip`);
const stagingDir = path.join(rootDir, '.package-temp');

if (manifest.version !== packageVersion) {
  throw new Error(`Manifest version ${manifest.version} does not match package version ${packageVersion}`);
}

const requiredFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.js',
  'popup.html',
  'popup.css',
  'options.js',
  'options.html',
  'options.css',
  'i18n.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
  ...['en', 'zh', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'ar'].map(
    (language) => `locales/${language}.js`
  ),
];

const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(rootDir, file)));
if (missingFiles.length > 0) {
  throw new Error(`Missing extension files: ${missingFiles.join(', ')}`);
}

if (process.argv.includes('--verify')) {
  const archivedFiles = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => file && !file.endsWith('/'))
    .sort();
  const expectedFiles = [...requiredFiles].sort();
  if (JSON.stringify(archivedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('Archive file list does not match the required extension files');
  }
  for (const file of requiredFiles) {
    const archivedContent = execFileSync('unzip', ['-p', archivePath, file]);
    if (!archivedContent.equals(fs.readFileSync(path.join(rootDir, file)))) {
      throw new Error(`Archive contains an outdated copy of ${file}`);
    }
  }
  for (const guide of [
    'chrome-extension/README.md',
    'documents/en/chrome-extension.md',
    'documents/zh/chrome-extension.md',
  ]) {
    const guidePath = path.resolve(rootDir, '..', guide);
    if (!fs.readFileSync(guidePath, 'utf8').includes(path.basename(archivePath))) {
      throw new Error(`${guide} does not link to ${path.basename(archivePath)}`);
    }
  }
  console.log(`Verified ${path.basename(archivePath)} (${requiredFiles.length} files and three download links)`);
  process.exit(0);
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

try {
  for (const file of requiredFiles) {
    const destination = path.join(stagingDir, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(rootDir, file), destination);
  }

  // zip updates existing archives, which can leave obsolete files behind.
  fs.rmSync(archivePath, { force: true });
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      "Compress-Archive -Path (Join-Path $env:MYTUBE_EXTENSION_PACKAGE_TEMP '*') -DestinationPath $env:MYTUBE_EXTENSION_ZIP -Force",
    ], {
      env: {
        ...process.env,
        MYTUBE_EXTENSION_PACKAGE_TEMP: stagingDir,
        MYTUBE_EXTENSION_ZIP: archivePath,
      },
      stdio: 'inherit',
    });
  } else {
    execFileSync('zip', ['-q', '-X', '-r', archivePath, '.'], {
      cwd: stagingDir,
      stdio: 'inherit',
    });
  }

  console.log(`Created ${path.basename(archivePath)} (${requiredFiles.length} files)`);
} finally {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
