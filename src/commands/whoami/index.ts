import { CommandModule } from "yargs";
import { FaableApi } from "../../api/FaableApi";
import { log } from "../../log";

import { context } from "../../api/context";

export const whoami: CommandModule = {
  command: "whoami",
  describe: "Display the current logged in user",
  handler: async () => {
    const { api } = await context();
    if (!api) {
      log.error("❌ Not logged in. Run 'faable login' first.");
      process.exit(1);
    }
    try {
      const me = await api.getMe();
      log.info(`Logged in as: ${me.email}`);
    } catch (e) {
      log.error("❌ Not logged in or session expired");
      process.exit(1);
    }
  },
};
