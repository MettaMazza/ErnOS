/**
 * Python Layer — Heavy science computation via subprocess.
 *
 * Spawns a Python process running scripts/run-science-sandbox.py
 * for NumPy/SciPy/SymPy calculations that math.js can't handle.
 *
 * Safety: Python sandbox blocks file I/O, network, dangerous builtins.
 * Timeout: default 10s, max 30s.
 */
import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "node:url";
const logger = {
  info: (msg: string) => console.log(`[science.python] ${msg}`),
  warn: (msg: string) => console.warn(`[science.python] ${msg}`),
  error: (msg: string) => console.error(`[science.python] ${msg}`),
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Find the actual project root by looking for package.json
let currentDir = __dirname;
while (!require("fs").existsSync(path.join(currentDir, "package.json"))) {
  const parent = path.dirname(currentDir);
  if (parent === currentDir) {
    // Fallback to process.cwd() if we hit the root of the filesystem without finding package.json
    currentDir = process.cwd();
    break;
  }
  currentDir = parent;
}
const PROJECT_ROOT = currentDir;

// Candidate Python paths (prefer venvs, fall back to system)
const PYTHON_CANDIDATES = [
  path.join(process.env.HOME || "", ".ernos", "qwen-tts-env", "bin", "python3.12"),
  path.join(process.env.HOME || "", ".ernos", "science-env", "bin", "python3"),
  "python3",
  "python",
];

const SANDBOX_SCRIPT = path.join(PROJECT_ROOT, "scripts", "run-science-sandbox.py");

export interface PythonResult {
  success: boolean;
  result?: string;
  type?: string;
  stdout?: string;
  error?: string;
}

function findPython(): string {
  const fs = require("fs");
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) {return candidate;}
    } catch {
      // skip
    }
  }
  return "python3"; // fallback
}

/**
 * Execute Python code in the sandbox.
 *
 * @param code - Python code to execute
 * @param timeoutSeconds - Max execution time (default 10, max 30)
 */
export async function executePython(
  code: string,
  timeoutSeconds = 10,
): Promise<PythonResult> {
  const pythonPath = findPython();
  const timeout = Math.min(Math.max(timeoutSeconds, 1), 30);

  logger.info(`Executing Python code (${code.length} chars, timeout: ${timeout}s)`);

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [SANDBOX_SCRIPT], {
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUNBUFFERED: "1",
      },
      timeout: (timeout + 5) * 1000, // Extra 5s for process overhead
      stdio: ["pipe", "pipe", "pipe"],
    });

    const payload = JSON.stringify({ code, timeout });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (exitCode) => {
      if (exitCode !== 0 && !stdout.trim()) {
        logger.warn(`Python process exited ${exitCode}: ${stderr.slice(0, 200)}`);
        resolve({
          success: false,
          error: `Python process failed (exit ${exitCode}): ${stderr.slice(0, 500)}`,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout) as PythonResult;
        if (result.success) {
          logger.info(`Python result: ${(result.result || "").slice(0, 100)}`);
        } else {
          logger.warn(`Python error: ${result.error}`);
        }
        resolve(result);
      } catch {
        // If stdout isn't valid JSON, return raw output
        resolve({
          success: stdout.trim().length > 0,
          result: stdout.trim() || undefined,
          error: stdout.trim() ? undefined : "No output from Python",
        });
      }
    });

    proc.on("error", (err) => {
      logger.error(`Python spawn error: ${err.message}`);
      resolve({
        success: false,
        error: `Failed to spawn Python: ${err.message}`,
      });
    });

    // Write payload to stdin
    proc.stdin.write(payload);
    proc.stdin.end();
  });
}
