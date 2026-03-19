import { CommandModule } from "yargs";
import { FaableApi } from "../../api/FaableApi";
import { log } from "../../log";

import { context } from "../../api/context";

export const auth: CommandModule = {
  command: "auth",
  describe: "Manage authentication",
  builder: (yargs) => {
    return yargs.command({
      command: "status",
      describe: "Check authentication status",
      handler: async () => {
        const { api } = await context();
        if (!api) {
          log.error("❌ Not authenticated. Run 'faable login' first.");
          process.exit(1);
        }
        try {
          const me = await api.getMe();
          log.info(`✅ Authenticated as ${me.email}`);
        } catch (e) {
          log.error("❌ Not authenticated or session expired");
          process.exit(1);
        }
      },
    }) as any;
  },
  handler: () => {},
};
