import { YT_DLP_PYTHON_PROBE_TIMEOUT_MS } from "../constants";
import { logger } from "../../logger";
import { runProcess } from "./process";

export type PythonInterpreter = {
  command: string;
  prefixArgs: string[];
  executable: string;
};

function pythonCandidates(): Array<{ command: string; prefixArgs: string[] }> {
  if (process.platform === "win32") {
    return [
      { command: "py", prefixArgs: ["-3"] },
      { command: "python", prefixArgs: [] },
      { command: "python3", prefixArgs: [] },
    ];
  }
  return [
    { command: "python3", prefixArgs: [] },
    { command: "python", prefixArgs: [] },
  ];
}

export async function discoverPythonInterpreter(): Promise<PythonInterpreter> {
  for (const candidate of pythonCandidates()) {
    const discovered = await probePythonCandidate(candidate);
    if (discovered) {
      logger.info(
        `[yt-dlp] Using Python interpreter ${discovered.executable}`
      );
      return discovered;
    }
  }
  throw new Error(
    "No usable Python interpreter with pip was found. Install Python 3 and pip to manage yt-dlp."
  );
}

async function probePythonCandidate(candidate: {
  command: string;
  prefixArgs: string[];
}): Promise<PythonInterpreter | null> {
  const executableProbe = await runProcess(
    candidate.command,
    [
      ...candidate.prefixArgs,
      "-c",
      "import json,sys; print(json.dumps(sys.executable))",
    ],
    { timeoutMs: YT_DLP_PYTHON_PROBE_TIMEOUT_MS }
  );
  if (executableProbe.timedOut || executableProbe.code !== 0) {
    return null;
  }
  let executable = executableProbe.stdout.trim().replace(/^"|"$/g, "");
  try {
    executable = JSON.parse(executableProbe.stdout.trim());
  } catch {
    return null;
  }
  if (typeof executable !== "string" || !executable) {
    return null;
  }

  const pipProbe = await runProcess(executable, ["-m", "pip", "--version"], {
    timeoutMs: YT_DLP_PYTHON_PROBE_TIMEOUT_MS,
  });
  if (pipProbe.timedOut || pipProbe.code !== 0) {
    return null;
  }

  return {
    command: executable,
    prefixArgs: [],
    executable,
  };
}
