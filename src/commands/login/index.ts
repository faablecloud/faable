import { CommandModule } from "yargs";
import { FaableApi } from "../../api/FaableApi";
import { CredentialsStore } from "../../lib/CredentialsStore";
import prompts from "prompts";
import open from "open";
import { log } from "../../log";

export const login: CommandModule = {
  command: "login",
  describe: "Login to Faable",
  builder: (yargs) => {
    return yargs
      .option("apikey", {
        type: "string",
        description: "Login using an API Key",
      })
      .option("token", {
        type: "string",
        description: "Login using an OIDC token",
      })
      .showHelpOnFail(false) as any;
  },
  handler: async (args) => {
    const { apikey, token } = args as any;
    const store = new CredentialsStore();
    const api = FaableApi.create(); // Base client for device flow

    if (apikey) {
      log.info("Logging in with API Key...");
      const tempApi = FaableApi.create({ auth: { apikey }, authStrategy: (await import("../../api/strategies/apikey.strategy")).apikey_strategy });
      try {
        const me = await tempApi.getMe();
        await store.saveCredentials({ apikey, email: me.email });
        log.info(`✅ Successfully logged in as ${me.email}`);
      } catch (e) {
        log.error("❌ Invalid API Key");
        process.exit(1);
      }
      return;
    }

    if (token) {
        log.info("Logging in with OIDC token...");
        const tempApi = FaableApi.create({ auth: { idToken: token }, authStrategy: (await import("../../api/strategies/oidc.strategy")).oidc_strategy });
        try {
          const me = await tempApi.getMe();
          await store.saveCredentials({ token, email: me.email });
          log.info(`✅ Successfully logged in as ${me.email}`);
        } catch (e) {
          log.error("❌ Invalid OIDC token");
          process.exit(1);
        }
        return;
    }

    // Interactive Device Flow
    log.info("Starting browser-based authentication...");
    try {
      const { device_code, user_code, verification_uri, interval, expires_in } = await api.getDeviceCode();

      log.info(`\nVerification code: ${user_code}\n`);
      log.info(`If your browser doesn't open automatically, please visit:\n${verification_uri}\n`);

      try {
        await open(verification_uri);
      } catch (e) {
        log.warn("Could not open browser automatically.");
      }

      // Polling
      const start = Date.now();
      const timeout = expires_in * 1000;
      
      while (Date.now() - start < timeout) {
        try {
          const { access_token } = await api.getDeviceToken(device_code);
          if (access_token) {
            log.info("Token received!");
            const tempApi = FaableApi.create({ auth: { token: access_token }, authStrategy: () => ({ headers: async () => ({ Authorization: `Bearer ${access_token}` }) }) });
            const me = await tempApi.getMe();
            await store.saveCredentials({ token: access_token, email: me.email });
            log.info(`✅ Successfully logged in as ${me.email}`);
            return;
          }
        } catch (e: any) {
          // Typically returns 400 with "authorization_pending"
          if (e.cause?.response?.data?.error === "authorization_pending") {
              // Wait and continue
          } else if (e.cause?.response?.data?.error === "slow_down") {
              // Should increase interval but for now we just wait
          } else if (e.cause?.response?.headers?.["content-type"]?.includes("application/json")) {
              // Other error
          }
        }
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
      }
      log.error("❌ Authentication timed out");
      process.exit(1);
    } catch (e: any) {
      log.error(`❌ Failed to start authentication: ${e.message}`);
      process.exit(1);
    }
  },
};
