import { CommandModule } from "yargs";
import { CredentialsStore } from "../../lib/CredentialsStore";
import { log } from "../../log";

export const logout: CommandModule = {
  command: "logout",
  describe: "Logout from Faable",
  handler: async () => {
    const store = new CredentialsStore();
    await store.deleteCredentials();
    log.info("✅ Successfully logged out");
  },
};
