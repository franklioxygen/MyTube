import { execFile } from "child_process";

type ExecFileSafeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
};

/**
 * Safely execute a command with arguments
 * Prevents command injection by using execFile instead of exec
 */
export function execFileSafe(
  command: string,
  args: string[],
  options?: ExecFileSafeOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}
