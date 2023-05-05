import { spawn, exec } from "promisify-child-process";

interface CmdParams {
  /** Show output */
  enableOutput: boolean;
  /** Command timeout in milliseconds */
  timeout: number;
  /** Sets workdir */
  cwd: string;
}

export const cmd = async (
  cmd: string,
  args?: string[],
  params?: Partial<CmdParams>
) => {
  // Defaults
  const enableOutput = params?.enableOutput || false;
  const timeout = params?.timeout;
  const cwd = params?.cwd;

  const child = spawn(cmd, args, {
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
    console.log(output);
    throw new Error(`Error running command`);
  }
};
