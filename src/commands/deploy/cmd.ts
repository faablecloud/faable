import { spawn } from "promisify-child-process";

interface CmdParams {
  enableOutput?: boolean;
}

export const cmd = async (
  cmd: string,
  args?: string[],
  params: CmdParams = { enableOutput: false }
) => {
  const { enableOutput } = params;
  const child = spawn(cmd, args, {
    encoding: "utf8",
    stdio: enableOutput ? "inherit" : "pipe",
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
