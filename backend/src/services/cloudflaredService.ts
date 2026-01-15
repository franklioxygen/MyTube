import { ChildProcess, execSync, spawn } from "child_process";
import * as fs from "fs";
import { logger } from "../utils/logger";

class CloudflaredService {
  private process: ChildProcess | null = null;
  private isRunning: boolean = false;
  private tunnelId: string | null = null;
  private accountTag: string | null = null;
  private publicUrl: string | null = null;

  private parseToken(token: string) {
    try {
      const buffer = Buffer.from(token, "base64");
      const decoded = JSON.parse(buffer.toString());
      // Token format usually contains: a (account tag), t (tunnel id), s (secret)
      this.accountTag = decoded.a || null;
      this.tunnelId = decoded.t || null;
    } catch (error) {
      logger.error("Failed to parse Cloudflare token", error);
      this.tunnelId = null;
      this.accountTag = null;
    }
  }

  private resolveCloudflaredPath(): string | null {
    const isWindows = process.platform === "win32";
    const executableName = isWindows ? "cloudflared.exe" : "cloudflared";

    // Build potential paths based on platform
    const potentialPaths: string[] = [];

    if (isWindows) {
      // Windows common installation paths
      const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
      const programFilesX86 =
        process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
      const localAppData = process.env["LOCALAPPDATA"] || "";

      potentialPaths.push(
        `${programFiles}\\Cloudflare\\cloudflared\\${executableName}`,
        `${programFilesX86}\\Cloudflare\\cloudflared\\${executableName}`,
        `${localAppData}\\Cloudflare\\cloudflared\\${executableName}`,
        `${
          process.env["USERPROFILE"] || ""
        }\\AppData\\Local\\Cloudflare\\cloudflared\\${executableName}`
      );
    } else {
      // Unix-like systems (macOS, Linux)
      potentialPaths.push(
        "/opt/homebrew/bin/cloudflared", // MacOS Apple Silicon
        "/usr/local/bin/cloudflared", // MacOS Intel / Linux
        "/usr/bin/cloudflared" // Linux common path
      );
    }

    // First, check absolute paths
    for (const path of potentialPaths) {
      if (path && fs.existsSync(path)) {
        logger.debug(`Found cloudflared at: ${path}`);
        return path;
      }
    }

    // Then, check if cloudflared is in PATH using which/where
    try {
      const command = isWindows ? "where" : "which";
      const path = execSync(`${command} ${executableName}`, {
        encoding: "utf-8",
      }).trim();
      if (path) {
        // On Windows, 'where' may return multiple paths, take the first one
        const firstPath = path.split("\n")[0].trim();
        logger.debug(`Found cloudflared in PATH at: ${firstPath}`);
        return firstPath;
      }
    } catch (error) {
      // which/where command failed, cloudflared not in PATH
      logger.debug("cloudflared not found in system PATH");
    }

    // Not found anywhere
    return null;
  }

  public start(token?: string, port: number = 5551) {
    if (this.isRunning) {
      logger.info("Cloudflared service is already running.");
      if (token) this.parseToken(token);
      return;
    }

    this.publicUrl = null; // Reset URL

    let args: string[] = [];

    if (token) {
      // Named Tunnel
      this.parseToken(token);
      logger.info(
        `Starting Cloudflared Named Tunnel (ID: ${this.tunnelId})...`
      );
      args = ["tunnel", "run", "--token", token];
    } else {
      // Quick Tunnel
      this.tunnelId = null;
      this.accountTag = null;
      logger.info(`Starting Cloudflared Quick Tunnel on port ${port}...`);
      args = ["tunnel", "--url", `http://localhost:${port}`];
    }

    try {
      const executablePath = this.resolveCloudflaredPath();

      if (!executablePath) {
        const isWindows = process.platform === "win32";
        let errorMessage =
          "cloudflared executable not found. Please install cloudflared:\n";

        if (isWindows) {
          errorMessage +=
            "  Windows: Download from https://github.com/cloudflare/cloudflared/releases\n" +
            "    Or use: winget install --id Cloudflare.cloudflared\n" +
            "    Or use: scoop install cloudflared\n" +
            "    Or ensure cloudflared.exe is in your system PATH";
        } else if (process.platform === "darwin") {
          errorMessage += "  macOS: brew install cloudflared";
        } else {
          errorMessage +=
            "  Linux: Download from https://github.com/cloudflare/cloudflared/releases";
        }

        errorMessage += "\n  Or ensure cloudflared is in your system PATH";

        logger.error(errorMessage);
        this.isRunning = false;
        this.publicUrl = null;
        return;
      }

      logger.info(`Spawning cloudflared using: ${executablePath}`);
      this.process = spawn(executablePath, args);

      const handleOutput = (data: Buffer) => {
        const message = data.toString();
        // Simple logging
        logger.debug(`Cloudflared: ${message}`);

        // Capture Quick Tunnel URL
        // Example line: 2023-10-27T10:00:00Z INF |  https://random-name.trycloudflare.com  |
        const urlMatch = message.match(
          /https?:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/
        );
        if (urlMatch) {
          this.publicUrl = urlMatch[0];
          logger.info(`Cloudflared Quick Tunnel URL: ${this.publicUrl}`);
        }
      };

      this.process.stdout?.on("data", handleOutput);
      this.process.stderr?.on("data", handleOutput); // Cloudflared often logs to stderr

      this.process.on("close", (code) => {
        logger.info(`Cloudflared exited with code ${code}`);
        this.isRunning = false;
        this.process = null;
        this.publicUrl = null;
      });

      this.process.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          const isWindows = process.platform === "win32";
          let errorMessage =
            "cloudflared executable not found. Please install cloudflared:\n";

          if (isWindows) {
            errorMessage +=
              "  Windows: Download from https://github.com/cloudflare/cloudflared/releases\n" +
              "    Or use: winget install --id Cloudflare.cloudflared\n" +
              "    Or use: scoop install cloudflared\n" +
              "    Or ensure cloudflared.exe is in your system PATH";
          } else if (process.platform === "darwin") {
            errorMessage += "  macOS: brew install cloudflared";
          } else {
            errorMessage +=
              "  Linux: Download from https://github.com/cloudflare/cloudflared/releases";
          }

          errorMessage += "\n  Or ensure cloudflared is in your system PATH";

          logger.error(errorMessage);
        } else {
          logger.error("Failed to start Cloudflared process:", err);
        }
        this.isRunning = false;
        this.process = null;
        this.publicUrl = null;
      });

      this.isRunning = true;
      logger.info("Cloudflared process spawned.");
    } catch (error) {
      logger.error("Error spawning cloudflared:", error);
      this.isRunning = false;
      this.publicUrl = null;
    }
  }

  public stop() {
    if (this.process) {
      logger.info("Stopping Cloudflared tunnel...");
      this.process.kill();
      this.process = null;
      this.isRunning = false;
      this.publicUrl = null;
      logger.info("Cloudflared tunnel stopped.");
    } else {
      logger.info("No Cloudflared process is running to stop.");
    }
  }

  public restart(token?: string, port: number = 5551) {
    logger.info("Restarting Cloudflared tunnel...");
    this.stop();
    setTimeout(() => {
      this.start(token, port);
    }, 1000); // Wait a second before restarting
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      tunnelId: this.tunnelId,
      accountTag: this.accountTag,
      publicUrl: this.publicUrl,
    };
  }
}

export const cloudflaredService = new CloudflaredService();
