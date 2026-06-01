#!/usr/bin/env node

const supportedMajors = new Set([20, 22, 23, 24, 25, 26]);
const currentVersion = process.versions.node;
const currentMajor = Number.parseInt(currentVersion.split(".")[0], 10);
const installTarget = process.argv[2] || "MyTube";

if (process.env.MYTUBE_SKIP_NODE_VERSION_CHECK === "1") {
  process.exit(0);
}

if (supportedMajors.has(currentMajor)) {
  process.exit(0);
}

console.error(
  `[install] ${installTarget} supports Node.js 20.x, 22.x, 23.x, 24.x, 25.x, and 26.x.`
);
console.error(`[install] Current Node.js version: ${currentVersion}`);
console.error(
  "[install] The backend depends on better-sqlite3. Unsupported Node.js versions can trigger a native rebuild and misleading node-gyp/Visual Studio errors during npm install."
);
console.error(
  "[install] Switch to a supported Node.js release and run npm install again."
);
console.error(
  "[install] To bypass this check temporarily, set MYTUBE_SKIP_NODE_VERSION_CHECK=1."
);

process.exit(1);
