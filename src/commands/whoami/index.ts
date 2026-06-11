import { CommandModule } from "yargs";
import { log } from "../../log";

import { getMe } from "../../api/auth";
import { loadLiveCredentials } from "../../api/session";
import { CredentialsStore } from "../../lib/CredentialsStore";

export const whoami: CommandModule = {
  command: "whoami",
  describe: "Display the current logged in user",
  handler: async () => {
    const store = new CredentialsStore();
    // Auto-refreshes an expired token via the stored refresh_token.
    const config = await loadLiveCredentials(store);

    // Bearer token from the environment (CI) or a local `faable login`.
    const token = process.env.FAABLE_TOKEN || config?.token;

    if (!token) {
      // API-key sessions can't be introspected at the auth server's /me; fall
      // back to the email captured at login time.
      if (config?.apikey && config.email) {
        log.info(`Logged in as: ${config.email} (API key)`);
        return;
      }
      log.error("❌ Not logged in. Run 'faable login' first.");
      process.exit(1);
    }

    try {
      // Validate against the Auth server (it issued the token); the deploy API
      // has no /me route.
      const me = await getMe(token);
      log.info(`Logged in as: ${me.email}`);
    } catch {
      log.error("❌ Not logged in or session expired");
      process.exit(1);
    }
  },
};
