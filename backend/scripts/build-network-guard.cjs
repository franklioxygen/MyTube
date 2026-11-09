const { execFileSync } = require('node:child_process');
const path = require('node:path');
if (process.platform === 'linux') {
  execFileSync(process.env.CC || 'cc', [
    '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-shared',
    path.join(__dirname, 'network-guard.c'), '-o', path.join(__dirname, 'network-guard.so'), '-ldl', '-pthread',
  ], { stdio: 'inherit' });
}
