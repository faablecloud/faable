import { spawn } from "promisify-child-process";

export const cmd = async (cmd: string, args?: string[]) => {
  const { stdout, stderr } = await spawn(cmd, args, {
    encoding: "utf8",
    stdio: "inherit",
  });
  return stdout;
};
