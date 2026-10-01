import { CommandModule } from "yargs";
import { log } from "../../log";

import { getMe } from "../../api/auth";
import { resolveTenant, type Tenant } from "../../api/auth_admin";
import { FaableApi } from "../../api/FaableApi";
import { SOURCE_LABEL, requireProject } from "../../api/project";
import { loadLiveCredentials } from "../../api/session";
import { bearer_strategy } from "../../api/strategies/bearer.strategy";
import { CredentialsStore } from "../../lib/CredentialsStore";
import { json_option, print, print_json } from "../../lib/listing";

// Who you are, and what the CLI acts on: the active project and the Auth
// tenant `faable auth` would manage. The context is best-effort — a missing
// project is something to show, not a reason to fail `whoami`.
const describeContext = async (token: string) => {
  const api = FaableApi.create({ authStrategy: bearer_strategy, auth: { token } });
  let project: { id: string; name?: string; source: string } | { error: string };
  let tenant: Tenant | { error: string };
  try {
    const { id, source } = await requireProject(api);
    const p = await api.getProject(id).catch(() => undefined);
    project = { id, name: p?.name, source };
  } catch (e) {
    project = { error: (e as Error).message };
  }
  try {
    tenant = await resolveTenant({}, api);
  } catch (e) {
    tenant = { error: (e as Error).message };
  }
  return { project, tenant };
};

export const whoami: CommandModule<unknown, { json?: boolean }> = {
  command: "whoami",
  describe: "Show the logged in user, the active project and its Auth tenant",
  builder: (yargs) => json_option(yargs) as any,
  handler: async (args) => {
    const store = new CredentialsStore();
    // Auto-refreshes an expired token via the stored refresh_token.
    const config = await loadLiveCredentials(store);

    // Bearer token from the environment (CI) or a local `faable login`.
    const token = process.env.FAABLE_TOKEN || config?.token;

    if (!token) {
      // API-key sessions can't be introspected at the auth server's /me; fall
      // back to the email captured at login time.
      if (config?.apikey && config.email) {
        if (args.json) return print_json({ email: config.email, credential: "apikey" });
        print(`Logged in as: ${config.email} (API key)`);
        return;
      }
      log.error("❌ Not logged in. Run 'faable login' first.");
      process.exit(1);
    }

    let me: { email: string };
    try {
      // Validate against the Auth server (it issued the token); the deploy API
      // has no /me route.
      me = await getMe(token);
    } catch {
      log.error("❌ Not logged in or session expired");
      process.exit(1);
    }

    const { project, tenant } = await describeContext(token);
    if (args.json) {
      return print_json({ email: me.email, credential: "token", project, auth_tenant: tenant });
    }

    print(`Logged in as: ${me.email}`);
    if ("error" in project) {
      print(`Project:      none — faable project use <id|name>`);
    } else {
      const name = project.name ? `${project.name} (${project.id})` : project.id;
      print(`Project:      ${name}  [${SOURCE_LABEL[project.source as keyof typeof SOURCE_LABEL]}]`);
    }
    if ("error" in tenant) {
      print(`Auth tenant:  none — ${tenant.error}`);
    } else {
      const parts = [tenant.name, tenant.account && `(${tenant.account})`, tenant.domain];
      print(`Auth tenant:  ${parts.filter(Boolean).join(" ")}`);
    }
  },
};
