import fs from "fs-extra";
import path from "path";
import { BuilderContext } from "builder/Builder";
import { cmd } from "../../lib/cmd";

export const engine_version = async (ctx: BuilderContext) => {
  const { workdir, log } = ctx;
  const packageJSONFile = path.join(workdir, "package.json");

  // Check we have a valid name
  const { name, engines } = fs.readJSONSync(packageJSONFile);
  if (!name) {
    throw new Error("Missing name in package.json");
  }

  // Use engines.node if found
  let version = "18.19.0";
  if (engines?.node) {
    try {
      const check_cmd = `npm view node@"${engines.node}" version | tail -n 1 | cut -d "'" -f2`;
      const out = await cmd(check_cmd);
      version = out.stdout.toString().trim();
      log.info(
        `✅ Engine "${engines.node}" from package.json resolved to node@${version}`
      );
    } catch (e) {
      throw new Error(`Node version is not valid (${engines.node})`);
    }
  }

  return {
    version,
  };
};
