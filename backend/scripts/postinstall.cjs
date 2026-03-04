const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

function commandSucceeds(command, args, options = {}) {
  const result = cp.spawnSync(command, args, {
    shell: isWindows,
    ...options,
  });

  return result.status === 0;
}

function runCommand(command, args, options = {}) {
  return commandSucceeds(command, args, {
    stdio: "inherit",
    ...options,
  });
}

function hasCommand(command, probes = [["--version"], ["-version"]]) {
  return probes.some((probeArgs) =>
    commandSucceeds(command, probeArgs, {
      stdio: "ignore",
    })
  );
}

function mediaToolsAvailable() {
  return (
    hasCommand("ffmpeg", [["-version"], ["--version"]]) &&
    hasCommand("ffprobe", [["-version"], ["--version"]])
  );
}

function hasPasswordlessSudo() {
  return commandSucceeds("sudo", ["-n", "true"], {
    stdio: "ignore",
  });
}

function buildInstallAttempts() {
  if (isWindows) {
    return [
      {
        label: "winget",
        available: () => hasCommand("winget"),
        steps: [
          {
            command: "winget",
            args: [
              "install",
              "--id",
              "Gyan.FFmpeg",
              "--exact",
              "--silent",
              "--accept-package-agreements",
              "--accept-source-agreements",
            ],
          },
        ],
      },
      {
        label: "choco",
        available: () => hasCommand("choco"),
        steps: [{ command: "choco", args: ["install", "ffmpeg", "-y"] }],
      },
      {
        label: "scoop",
        available: () => hasCommand("scoop"),
        steps: [{ command: "scoop", args: ["install", "ffmpeg"] }],
      },
    ];
  }

  if (isMac) {
    return [
      {
        label: "brew",
        available: () => hasCommand("brew"),
        steps: [{ command: "brew", args: ["install", "ffmpeg"] }],
      },
    ];
  }

  if (isLinux) {
    const attempts = [];
    const hasSudo = hasCommand("sudo");
    const sudoWithoutPassword = hasSudo && hasPasswordlessSudo();

    if (hasSudo && !sudoWithoutPassword) {
      console.warn(
        "[postinstall] sudo is available but requires a password. Non-interactive auto-install may fail."
      );
      console.warn(
        "[postinstall] Re-run the suggested install command manually with interactive sudo, or set SKIP_FFMPEG_AUTO_INSTALL=1."
      );
    }

    const addAttempt = (label, command, args) => {
      attempts.push({
        label,
        available: () => hasCommand(command),
        steps: sudoWithoutPassword
          ? [{ command: "sudo", args: ["-n", command, ...args] }]
          : [{ command, args }],
      });
    };

    addAttempt("apt-get", "apt-get", ["install", "-y", "ffmpeg"]);
    addAttempt("dnf", "dnf", ["install", "-y", "ffmpeg"]);
    addAttempt("yum", "yum", ["install", "-y", "ffmpeg"]);
    addAttempt("pacman", "pacman", ["-S", "--noconfirm", "ffmpeg"]);
    addAttempt("apk", "apk", ["add", "ffmpeg"]);
    addAttempt("zypper", "zypper", ["install", "-y", "ffmpeg"]);

    return attempts;
  }

  return [];
}

function printManualInstallHelp() {
  console.warn("[postinstall] ffmpeg/ffprobe still missing.");
  console.warn("[postinstall] Install manually and re-run backend install.");

  if (isWindows) {
    console.warn(
      "[postinstall] Windows examples: `winget install --id Gyan.FFmpeg --exact` or `choco install ffmpeg -y`"
    );
    return;
  }

  if (isMac) {
    console.warn("[postinstall] macOS example: `brew install ffmpeg`");
    return;
  }

  if (isLinux) {
    console.warn(
      "[postinstall] Linux example: `sudo apt-get install -y ffmpeg` (or your distro package manager)"
    );
    return;
  }

  console.warn(
    "[postinstall] Unsupported OS. Please install ffmpeg and ffprobe manually."
  );
}

function tryInstallMediaTools() {
  if (process.env.SKIP_FFMPEG_AUTO_INSTALL) {
    console.log(
      "[postinstall] SKIP_FFMPEG_AUTO_INSTALL is set, skipping ffmpeg auto-install."
    );
    return;
  }

  if (mediaToolsAvailable()) {
    console.log("[postinstall] ffmpeg and ffprobe already available.");
    return;
  }

  console.warn(
    "[postinstall] ffmpeg/ffprobe not found. Attempting automatic installation..."
  );

  const attempts = buildInstallAttempts();
  if (attempts.length === 0) {
    printManualInstallHelp();
    return;
  }

  for (const attempt of attempts) {
    if (!attempt.available()) {
      continue;
    }

    console.log(`[postinstall] Trying installer: ${attempt.label}`);
    let ok = true;

    for (const step of attempt.steps) {
      const stepOk = runCommand(step.command, step.args);
      if (!stepOk) {
        ok = false;
        break;
      }
    }

    if (!ok) {
      console.warn(`[postinstall] ${attempt.label} installation attempt failed.`);
      continue;
    }

    if (mediaToolsAvailable()) {
      console.log(
        `[postinstall] ffmpeg/ffprobe installed successfully via ${attempt.label}.`
      );
      return;
    }

    console.warn(
      `[postinstall] ${attempt.label} finished, but ffmpeg/ffprobe are still unavailable.`
    );
  }

  printManualInstallHelp();
}

function buildProviderServer() {
  if (process.env.SKIP_PROVIDER_BUILD) {
    console.log(
      "[postinstall] SKIP_PROVIDER_BUILD is set, skipping provider build."
    );
    return;
  }

  const providerPath = path.join(
    __dirname,
    "..",
    "bgutil-ytdlp-pot-provider",
    "server"
  );

  if (!fs.existsSync(providerPath)) {
    console.log(
      `[postinstall] Skipping provider build: ${providerPath} not found.`
    );
    return;
  }

  console.log("[postinstall] Building provider...");
  cp.execSync("npm install && npx tsc", {
    cwd: providerPath,
    stdio: "inherit",
    shell: true,
  });
}

function main() {
  tryInstallMediaTools();
  buildProviderServer();
}

main();
