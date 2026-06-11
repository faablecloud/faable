import { CommandModule } from "yargs";
import { FaableApi } from "../../api/FaableApi";
import { getDeviceCode, getDeviceToken, getMe } from "../../api/auth";
import { CredentialsStore } from "../../lib/CredentialsStore";
import open from "open";
import ora from "ora";
import { log } from "../../log";

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const renderUserCodeBlock = (code: string): string => {
  const padded = `   ${code}   `;
  const border = "─".repeat(padded.length);
  return [
    "",
    `  ┌${border}┐`,
    `  │${padded}│`,
    `  └${border}┘`,
    "",
  ].join("\n");
};

type OAuthError = {
  error?: string;
  error_description?: string;
};

const extractOAuthError = (e: any): OAuthError => {
  const data = e?.response?.data || e?.cause?.response?.data || {};
  if (typeof data === "object") return data as OAuthError;
  return {};
};

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

    if (apikey) {
      log.info("Logging in with API Key...");
      const tempApi = FaableApi.create({ auth: { apikey }, authStrategy: (await import("../../api/strategies/apikey.strategy")).apikey_strategy });
      try {
        const me = await tempApi.getMe();
        await store.saveCredentials({ apikey, email: me.email });
        log.info(`✅ Successfully logged in as ${me.email}`);
      } catch {
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
        } catch {
          log.error("❌ Invalid OIDC token");
          process.exit(1);
        }
        return;
    }

    // Interactive Device Authorization Grant (RFC 8628)
    log.info("Starting browser-based authentication...");

    let device_code: string;
    let user_code: string;
    let verification_uri: string;
    let verification_uri_complete: string;
    let interval: number;
    let expires_in: number;

    try {
      const dc = await getDeviceCode();
      device_code = dc.device_code;
      user_code = dc.user_code;
      verification_uri = dc.verification_uri;
      verification_uri_complete = dc.verification_uri_complete;
      interval = dc.interval;
      expires_in = dc.expires_in;
    } catch (e: any) {
      log.error(`❌ Failed to start authentication: ${e.message}`);
      process.exit(1);
    }

    process.stdout.write(renderUserCodeBlock(user_code));
    log.info(`If your browser doesn't open automatically, visit: ${verification_uri}`);

    try {
      await open(verification_uri_complete);
    } catch {
      log.warn("Could not open browser automatically.");
    }

    const spinner = ora({
      text: "Waiting for confirmation in browser…",
      spinner: "dots",
    }).start();

    let cancelled = false;
    const onSigint = () => {
      cancelled = true;
      spinner.stop();
      process.stderr.write("\nLogin cancelled.\n");
      process.exit(130);
    };
    process.once("SIGINT", onSigint);

    const start = Date.now();
    const timeoutMs = expires_in * 1000;
    let currentInterval = interval;

    try {
      while (!cancelled && Date.now() - start < timeoutMs) {
        await wait(currentInterval * 1000);
        if (cancelled) return;

        try {
          const { access_token } = await getDeviceToken(device_code);
          if (access_token) {
            spinner.stop();
            // Validate the freshly issued token against the Auth server (it
            // issued the token). The deploy API has no /me route.
            const me = await getMe(access_token);
            await store.saveCredentials({ token: access_token, email: me.email });
            log.info(`✅ Successfully logged in as ${me.email}`);
            return;
          }
        } catch (e: any) {
          const { error, error_description } = extractOAuthError(e);

          if (error === "authorization_pending") {
            continue;
          }

          if (error === "slow_down") {
            currentInterval += 5;
            spinner.text = `Waiting for confirmation in browser… (slowing polling to ${currentInterval}s)`;
            continue;
          }

          if (error === "access_denied") {
            spinner.stop();
            log.error("❌ Authorization denied. Run `faable login` again to retry.");
            process.exit(1);
          }

          if (error === "expired_token") {
            spinner.stop();
            log.error("❌ Code expired. Run `faable login` again to start over.");
            process.exit(1);
          }

          // Unknown OAuth error or non-OAuth failure
          spinner.stop();
          const detail = error_description || error || e?.message || "unknown error";
          log.error(`❌ Authentication failed: ${detail}`);
          process.exit(1);
        }
      }

      spinner.stop();
      log.error("❌ Code expired. Run `faable login` again to start over.");
      process.exit(1);
    } finally {
      process.removeListener("SIGINT", onSigint);
    }
  },
};
