import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { RALPH_DIR } from "../utils/constants.js";
import { exists } from "../utils/file-system.js";
import type { RalphProcess, RalphProcessState } from "./types.js";

const RALPH_LOOP_PATH = `${RALPH_DIR}/ralph_loop.sh`;
const BASH_RALPH_LOOP_PATH = `./${RALPH_LOOP_PATH}`;
const BASH_VALIDATION_TIMEOUT_MS = 3000;
const DEFAULT_WINDOWS_GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
] as const;

let cachedBashCommand: string | undefined;

export async function resolveBashCommand(): Promise<string> {
  if (cachedBashCommand) {
    return cachedBashCommand;
  }

  const candidates = process.platform === "win32" ? getWindowsBashCandidates() : ["bash"];

  for (const candidate of candidates) {
    if (await canExecuteBash(candidate)) {
      cachedBashCommand = candidate;
      return candidate;
    }
  }

  throw new Error(getMissingBashMessage());
}

export async function validateBashAvailable(): Promise<void> {
  await resolveBashCommand();
}

export async function validateRalphLoop(projectDir: string): Promise<void> {
  const loopPath = join(projectDir, RALPH_LOOP_PATH);
  if (!(await exists(loopPath))) {
    throw new Error(`${RALPH_LOOP_PATH} not found. Run: bmalph init`);
  }
}

export function spawnRalphLoop(
  projectDir: string,
  platformId: string,
  options: { inheritStdio: boolean }
): RalphProcess {
  const child = spawn(cachedBashCommand ?? "bash", [BASH_RALPH_LOOP_PATH], {
    cwd: projectDir,
    env: { ...process.env, PLATFORM_DRIVER: platformId },
    stdio: options.inheritStdio ? "inherit" : ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  let state: RalphProcessState = "running";
  let exitCode: number | null = null;
  let exitCallbacks: Array<(code: number | null) => void> = [];
  let exited = false;

  const handleExit = (code: number | null): void => {
    if (exited) return;
    state = "stopped";
    exitCode = code;
    exited = true;
    for (const cb of exitCallbacks) cb(code);
    exitCallbacks = [];
  };

  child.on("close", (code) => handleExit(code));
  child.on("error", () => handleExit(null));

  return {
    get child() {
      return child;
    },
    get state() {
      return state;
    },
    set state(s: RalphProcessState) {
      state = s;
    },
    get exitCode() {
      return exitCode;
    },
    set exitCode(c: number | null) {
      exitCode = c;
    },
    kill() {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          try {
            child.kill("SIGTERM");
          } catch {
            // Child already dead — ignore
          }
        }
      } else {
        child.kill("SIGTERM");
      }
    },
    detach() {
      child.unref();
      if (child.stdout) child.stdout.destroy();
      if (child.stderr) child.stderr.destroy();
      state = "detached";
    },
    onExit(callback) {
      if (exited) {
        callback(exitCode);
      } else {
        exitCallbacks.push(callback);
      }
    },
  };
}

function getWindowsBashCandidates(): string[] {
  const discoveredPaths: string[] = [];

  try {
    const output = execFileSync("where", ["bash"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });

    for (const line of output.split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate.length === 0 || isWindowsBashShim(candidate)) {
        continue;
      }
      discoveredPaths.push(candidate);
    }
  } catch {
    // Ignore failed discovery and fall back to common Git Bash locations.
  }

  return uniqueWindowsPaths([...discoveredPaths, ...DEFAULT_WINDOWS_GIT_BASH_PATHS]);
}

function isWindowsBashShim(candidate: string): boolean {
  const normalized = candidate.replaceAll("/", "\\").toLowerCase();
  return (
    normalized.endsWith("\\windows\\system32\\bash.exe") ||
    (normalized.includes("\\windowsapps\\") && normalized.endsWith("\\bash.exe"))
  );
}

function uniqueWindowsPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const path of paths) {
    const normalized = path.trim();
    if (normalized.length === 0) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

async function canExecuteBash(command: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ["--version"], {
      stdio: "ignore",
      windowsHide: true,
    });

    let settled = false;

    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore kill failures for already exited processes.
      }
      finish(false);
    }, BASH_VALIDATION_TIMEOUT_MS);

    child.on("close", (code) => finish(code === 0));
    child.on("error", () => finish(false));
  });
}

function getMissingBashMessage(): string {
  return process.platform === "win32"
    ? "bash is not available. Install Git Bash to run Ralph on Windows."
    : "bash is not available. Install bash to run Ralph.";
}
