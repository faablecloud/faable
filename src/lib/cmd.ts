import { spawn } from "promisify-child-process";

interface CmdConfig {
  /** Show output */
  enableOutput: boolean;
  /** Command timeout in milliseconds */
  timeout: number;
  /** Sets workdir */
  cwd: string;
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
    // console.log(output);
    throw new Error(`Command error: ${cmd}`);
  }
};
