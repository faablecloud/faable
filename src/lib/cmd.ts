import { spawn } from "promisify-child-process";
import { log } from "../log";
import { buildLog } from "./log_buffer";

interface CmdConfig {
  /** Show output */
  enableOutput: boolean;
  /** Command timeout in milliseconds */
  timeout: number;
  /** Sets workdir */
  cwd: string;
  env?: Record<string, string>;
}

export const cmd = async (cmd: string, config?: Partial<CmdConfig>) => {
  // Defaults
  const enableOutput = config?.enableOutput || false;
  const timeout = config?.timeout;
  const cwd = config?.cwd;

  // Always pipe (never inherit) so the output can be captured into the
  // build-log buffer; enableOutput now means "also mirror to the terminal".
  // Subprocesses see a non-TTY and fall back to plain (uncolored) output —
  // the intended trade for being able to attach logs to the deployment.
  const child = spawn("/bin/bash", ["-c", cmd], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    // promisify-child-process kills the child with "maxBuffer size exceeded"
    // at 200KB once stdio is piped + encoding set. A docker build easily
    // exceeds that — never kill on output volume (buildLog caps separately).
    maxBuffer: Infinity,
    timeout,
    cwd,
    env: {
      ...process.env,
      ...config?.env,
    },
  });
  const out_data: Buffer[] = [];
  child.stderr?.on("data", (data) => {
    out_data.push(data);
    buildLog.append(data);
    if (enableOutput) process.stderr.write(data);
  });
  child.stdout?.on("data", (data) => {
    out_data.push(data);
    buildLog.append(data);
    if (enableOutput) process.stdout.write(data);
  });
  try {
    const result = await child;
    return result;
  } catch (error) {
    const output = out_data.map((b) => b.toString()).join("\n");
    log.error(error?.message);
    if (output) {
      log.error(output);
    }
    throw new Error(`Command error: ${cmd}`, { cause: error });
  }
};
