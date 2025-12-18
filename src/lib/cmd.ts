import { spawn } from "promisify-child-process";
import { log } from "../log";

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

  const child = spawn("/bin/bash", ["-c", cmd], {
    encoding: "utf8",
    stdio: enableOutput ? "inherit" : "pipe",
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
  });
  child.stdout?.on("data", (data) => {
    out_data.push(data);
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
    throw new Error(`Command error: ${cmd}`);
  }
};
