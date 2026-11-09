const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
if (process.platform === 'linux') {
  const source = path.join(__dirname, 'network-guard.c');
  const library = path.join(__dirname, 'network-guard.so');
  const current = fs.existsSync(library) && fs.statSync(library).mtimeMs >= fs.statSync(source).mtimeMs;
  if (!process.argv.includes('--if-needed') || !current) execFileSync(process.env.CC || 'cc', [
    '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-shared',
    source, '-o', library, '-ldl', '-pthread',
  ], { stdio: 'inherit' });
}
