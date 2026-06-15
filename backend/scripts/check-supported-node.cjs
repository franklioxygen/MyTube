#!/usr/bin/env node

const currentVersion = process.versions.node;
const [currentMajor, currentMinor, currentPatch] = currentVersion
  .split(".")
  .map((part) => Number.parseInt(part, 10));
const installTarget = process.argv[2] || "MyTube";

if (process.env.MYTUBE_SKIP_NODE_VERSION_CHECK === "1") {
  process.exit(0);
}

const current = {
  major: currentMajor,
  minor: currentMinor,
  patch: currentPatch,
};

const atLeast = (version, major, minor, patch) => {
  if (version.major !== major) {
    return false;
  }

  if (version.minor !== minor) {
    return version.minor > minor;
  }

  return version.patch >= patch;
};

const isSupported =
  atLeast(current, 20, 19, 0) ||
  atLeast(current, 22, 12, 0) ||
  (current.major >= 23 && current.major <= 26);

if (isSupported) {
  process.exit(0);
}

console.error(
  `[install] ${installTarget} supports Node.js 20.19+, 22.12+, 23.x, 24.x, 25.x, and 26.x.`
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
